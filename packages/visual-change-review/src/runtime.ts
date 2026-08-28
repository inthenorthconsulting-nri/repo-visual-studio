import { MOTION_ALGORITHMS, MOTION_PLAYER } from "@rvs/visual-grammar";
import { EXPLORER_ALGORITHMS } from "@rvs/visual-explorer";

// The review's browser runtime, authored as text.
//
// Same two-copy shape as @rvs/visual-explorer, for the same reason.
// `REVIEW_ALGORITHMS` is pure -- no `document`, no `window`, no host object at
// all -- and a test runs it inside an isolated VM against the same fixtures as
// the TypeScript in `lenses.ts` and asserts the two agree. That is what stops
// the browser copy from quietly becoming a second, untested implementation of
// what a lens means.
//
// Search is not reimplemented here. `EXPLORER_ALGORITHMS` is concatenated in
// front of these functions and `rvsSearchEntities` is called as-is, so the
// review and the explorer rank matches identically -- one search engine, one
// set of tests, one behaviour a reader can learn once.
//
// `REVIEW_RUNTIME_WIRING` is the half that touches the page. It reads a JSON
// island, toggles classes, moves focus, and writes text. It never constructs
// markup from data: every insertion goes through `textContent` or
// `createElement`, so a hostile label is text at every point and can never
// become an element. The viewer does not execute source data.
//
// What neither half does, at all: no `eval`, no `new Function`, no `fetch`, no
// `XMLHttpRequest`, no `WebSocket`, no dynamic `import`, no navigation, and no
// filesystem resolution of anything. The artifact is a file on disk that works
// with the network unplugged.

export const REVIEW_ALGORITHMS = String.raw`
"use strict";

/** Which of the eight change types a lens is about. Parity target: changeMatchesLens in lenses.ts. */
function rvsChangeMatchesLens(change, lens) {
  if (lens === "architecture") return true;
  if (lens === "capabilities") return change.capabilities.length > 0 || change.products.length > 0;
  if (lens === "governance") return change.findings.length > 0;
  if (lens === "decisions") return change.decisions.length > 0;
  if (lens === "impact") return change.paths.length > 0 || change.blast_radius !== "isolated";
  if (lens === "unresolved") {
    return change.type === "unresolved" || change.resolution !== "resolved" || change.blast_radius === "unresolved";
  }
  return true;
}

/** The entity ids a lens brings forward. Parity target: lensEntityIds in lenses.ts. */
function rvsLensEntityIds(model, lens) {
  var ids = [];
  for (var i = 0; i < model.changes.length; i++) {
    var change = model.changes[i];
    if (!rvsChangeMatchesLens(change, lens)) continue;
    ids.push(change.entity);
    if (change.before) ids.push(change.before);
    if (change.after) ids.push(change.after);
  }
  return rvsNormalizeIds(ids);
}

/**
 * Entities a lens de-emphasises.
 *
 * Muted, never removed: an entity outside the lens is still drawn, still in
 * the document, still found by search, still read aloud. A reader who cannot
 * see that something was excluded cannot tell an empty answer from an
 * unasked question.
 */
function rvsReviewMutedIds(model, lens, focusEntityId) {
  var brought = {};
  var ids = rvsLensEntityIds(model, lens);
  for (var i = 0; i < ids.length; i++) brought[ids[i]] = true;
  var muted = [];
  for (var n = 0; n < model.nodes.length; n++) {
    var node = model.nodes[n];
    if (node.entity === focusEntityId) continue;
    if (node.emphasis === "focal") continue;
    if (brought[node.entity] !== true) muted.push(node.entity);
  }
  return rvsNormalizeIds(muted);
}

/** Every change recorded against one entity, in id order. */
function rvsChangesForEntity(model, entityId) {
  var out = [];
  for (var i = 0; i < model.changes.length; i++) {
    if (model.changes[i].entity === entityId) out.push(model.changes[i]);
  }
  out.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
  return out;
}

/**
 * Every route a change sits on, strongest evidence first.
 *
 * The ordering is the point: a reviewer scanning the list must meet the routes
 * upstream actually traced before the ones assembled from shared evidence, or
 * a coincidence reads as a cause.
 */
function rvsRoutesForChange(model, changeId) {
  var order = { confirmed: 0, related: 1, unresolved: 2 };
  var out = [];
  for (var i = 0; i < model.paths.length; i++) {
    if (model.paths[i].from_change === changeId) out.push(model.paths[i]);
  }
  out.sort(function (a, b) {
    var oa = order[a.kind] === undefined ? 3 : order[a.kind];
    var ob = order[b.kind] === undefined ? 3 : order[b.kind];
    if (oa !== ob) return oa - ob;
    return a.id < b.id ? -1 : 1;
  });
  return out;
}

/** What the review could not determine about a change. Never summarised away, never rephrased. */
function rvsUnresolvedForChange(model, changeId) {
  var out = [];
  for (var i = 0; i < model.unresolved.length; i++) {
    if (model.unresolved[i].change === changeId) out.push(model.unresolved[i]);
  }
  out.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
  return out;
}

/**
 * Which of the three panels holds an entity.
 *
 * A missing side is reported as missing rather than inferred from the change
 * type: a presence of before=false / after=true is what the panels are told, and the
 * page draws an explicit "not present" slot for the false one instead of
 * leaving a gap the reader has to notice.
 */
function rvsPanelPresence(model, entityId) {
  var entity = model.entities[entityId];
  if (!entity) return { before: false, delta: false, after: false };
  var changed = rvsChangesForEntity(model, entityId).length > 0;
  return { before: entity.before === true, delta: changed, after: entity.after === true };
}
`;

/**
 * The page wiring.
 *
 * Kept separate from the algorithms above so the untestable half is as small
 * as it can be: class-setting, focus-moving, and text-writing, and nothing
 * else.
 */
export const REVIEW_RUNTIME_WIRING = String.raw`
(function () {
  "use strict";

  var island = document.getElementById("rvs-review");
  if (!island) return;
  var model;
  try {
    model = JSON.parse(island.textContent || "{}");
  } catch (error) {
    return;
  }

  var nodeByEntity = {};
  for (var i = 0; i < model.nodes.length; i++) nodeByEntity[model.nodes[i].entity] = model.nodes[i];
  var changeById = {};
  for (var c = 0; c < model.changes.length; c++) changeById[model.changes[c].id] = model.changes[c];
  var lensById = {};
  for (var l = 0; l < model.lenses.length; l++) lensById[model.lenses[l].id] = model.lenses[l];

  var els = {
    search: document.getElementById("rvs-search"),
    results: document.getElementById("rvs-results"),
    lens: document.getElementById("rvs-lens"),
    caveat: document.getElementById("rvs-lens-caveat"),
    changes: document.getElementById("rvs-change-list"),
    status: document.getElementById("rvs-status"),
    inspector: document.getElementById("rvs-inspector"),
    evidence: document.getElementById("rvs-evidence"),
    help: document.getElementById("rvs-help"),
    helpToggle: document.getElementById("rvs-help-toggle"),
    stage: document.getElementById("rvs-stage"),
    animate: document.getElementById("rvs-animate")
  };

  var state = { change: null, focus: null, lens: "architecture", query: "" };

  function say(message) {
    if (els.status) els.status.textContent = message;
  }

  function text(tag, value, className) {
    var el = document.createElement(tag);
    el.textContent = value;
    if (className) el.className = className;
    return el;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  /** Sets classes on all three panels at once. Selecting a change synchronises every state it appears in. */
  function paint() {
    var muted = {};
    var mutedIds = rvsReviewMutedIds(model, state.lens, state.focus);
    for (var m = 0; m < mutedIds.length; m++) muted[mutedIds[m]] = true;

    var routeEntities = {};
    var routeKind = {};
    if (state.change) {
      var routes = rvsRoutesForChange(model, state.change);
      for (var r = 0; r < routes.length; r++) {
        for (var e = 0; e < routes[r].entities.length; e++) {
          var id = routes[r].entities[e];
          routeEntities[id] = true;
          // Strongest evidence wins the line treatment, so a confirmed route
          // is never drawn as though it were a coincidence.
          if (routeKind[id] === undefined || routes[r].kind === "confirmed") routeKind[id] = routes[r].kind;
        }
      }
    }

    var groups = els.stage ? els.stage.querySelectorAll("[data-rvs-node]") : [];
    for (var g = 0; g < groups.length; g++) {
      var entity = groups[g].getAttribute("data-rvs-node");
      groups[g].classList.toggle("rvs-muted", muted[entity] === true && routeEntities[entity] !== true);
      groups[g].classList.toggle("rvs-focus", state.focus === entity);
      if (routeKind[entity]) groups[g].setAttribute("data-rvs-route", routeKind[entity]);
      else groups[g].removeAttribute("data-rvs-route");
    }
  }

  /**
   * The elements a motion target id addresses.
   *
   * An entity appears in up to three panels, and all three are returned: a
   * compare step is about one entity across its states, so emphasising one
   * panel and not the others would say the opposite of what compare means.
   */
  function motionTargets(id) {
    if (!els.stage) return [];
    return els.stage.querySelectorAll('[data-rvs-node="' + rvsMotionEscape(id) + '"]');
  }

  function describeChange(change) {
    clear(els.inspector);
    if (!change) {
      els.inspector.appendChild(text("p", "Select a change to see what it touches.", "rvs-empty"));
      return;
    }
    var entity = model.entities[change.entity] || { label: change.entity };
    els.inspector.appendChild(text("h3", entity.label || change.entity));

    var badge = document.createElement("p");
    badge.className = "rvs-change";
    badge.setAttribute("data-change", change.type);
    badge.appendChild(text("span", model.glyphs[change.type] || "*", "rvs-change-glyph"));
    badge.appendChild(text("span", change.type));
    els.inspector.appendChild(badge);
    els.inspector.appendChild(text("p", change.summary));

    var presence = rvsPanelPresence(model, change.entity);
    var states = document.createElement("dl");
    var rows = [
      ["Before", presence.before ? entity.label : null],
      ["After", presence.after ? entity.label : null],
      ["Entity kind", change.entity_type],
      ["Blast radius", change.blast_radius],
      ["Resolution", change.resolution],
      ["Review required", change.review_required ? "yes, recorded upstream" : "not recorded upstream"]
    ];
    for (var i = 0; i < rows.length; i++) {
      states.appendChild(text("dt", rows[i][0]));
      // An absent counterpart is stated, not left blank. "Not present in this
      // snapshot" and "I did not scroll far enough" look identical when the
      // answer is a gap.
      if (rows[i][1] === null) {
        var dd = document.createElement("dd");
        dd.appendChild(text("span", "Not present in this snapshot.", "rvs-absent"));
        states.appendChild(dd);
      } else {
        states.appendChild(text("dd", rows[i][1]));
      }
    }
    els.inspector.appendChild(states);

    var routes = rvsRoutesForChange(model, change.id);
    els.inspector.appendChild(text("h4", "Routes (" + routes.length + ")"));
    var routeList = document.createElement("ul");
    if (routes.length === 0) {
      routeList.appendChild(text("li", "No route was recorded from this change.", "rvs-empty"));
    }
    for (var p = 0; p < routes.length; p++) {
      routeList.appendChild(text("li", routes[p].kind + " — " + routes[p].description));
    }
    els.inspector.appendChild(routeList);

    var unresolved = rvsUnresolvedForChange(model, change.id);
    if (unresolved.length > 0) {
      els.inspector.appendChild(text("h4", "Not determined"));
      var unresolvedList = document.createElement("ul");
      for (var u = 0; u < unresolved.length; u++) {
        var line = unresolved[u].statement;
        if (unresolved[u].boundary) line = line + " Boundary: " + unresolved[u].boundary + ".";
        unresolvedList.appendChild(text("li", line));
      }
      els.inspector.appendChild(unresolvedList);
    }
  }

  /**
   * The evidence drawer.
   *
   * Everything in it was embedded when the artifact was built. Nothing here
   * reads a file, follows a path, or asks the network -- an evidence
   * reference is text for a person to open in their editor, and turning it
   * into something the page can follow is exactly what this artifact must not
   * do.
   */
  function describeEvidence(change) {
    clear(els.evidence);
    els.evidence.appendChild(text("h3", "Evidence"));
    if (!change) {
      els.evidence.appendChild(text("p", "Select a change to see the evidence recorded for it.", "rvs-empty"));
      return;
    }
    var refs = change.evidence || [];
    var list = document.createElement("ul");
    if (refs.length === 0) {
      list.appendChild(text("li", "No evidence reference was recorded upstream for this change.", "rvs-empty"));
    }
    for (var i = 0; i < refs.length; i++) list.appendChild(text("li", refs[i]));
    els.evidence.appendChild(list);

    var linked = [
      ["Governance findings", change.findings],
      ["Decisions", change.decisions],
      ["Capabilities", change.capabilities],
      ["Products", change.products]
    ];
    for (var k = 0; k < linked.length; k++) {
      els.evidence.appendChild(text("h4", linked[k][0] + " (" + linked[k][1].length + ")"));
      var sub = document.createElement("ul");
      if (linked[k][1].length === 0) {
        sub.appendChild(text("li", "None recorded upstream.", "rvs-empty"));
      }
      for (var j = 0; j < linked[k][1].length; j++) sub.appendChild(text("li", linked[k][1][j]));
      els.evidence.appendChild(sub);
    }
  }

  function renderChangeList() {
    clear(els.changes);
    var shown = [];
    for (var i = 0; i < model.changes.length; i++) {
      if (rvsChangeMatchesLens(model.changes[i], state.lens)) shown.push(model.changes[i]);
    }
    if (shown.length === 0) {
      var lens = lensById[state.lens] || {};
      els.changes.appendChild(
        text("li", "No change matched this lens. " + (lens.caveat || ""), "rvs-empty")
      );
      return;
    }
    for (var s = 0; s < shown.length; s++) {
      var item = document.createElement("li");
      var button = document.createElement("button");
      button.type = "button";
      button.setAttribute("data-rvs-change", shown[s].id);
      var entity = model.entities[shown[s].entity] || {};
      button.appendChild(text("span", model.glyphs[shown[s].type] || "*", "rvs-change-glyph"));
      button.appendChild(text("span", " " + (entity.label || shown[s].entity) + " · " + shown[s].type));
      item.appendChild(button);
      els.changes.appendChild(item);
    }
  }

  function renderResults(hits) {
    clear(els.results);
    if (hits.length === 0) {
      els.results.appendChild(
        text("li", state.query === "" ? "Type to search entities." : "No entity matched.", "rvs-empty")
      );
      return;
    }
    for (var h = 0; h < hits.length; h++) {
      var item = document.createElement("li");
      var button = document.createElement("button");
      button.type = "button";
      button.setAttribute("data-rvs-target", hits[h].source_entity_id);
      button.textContent = hits[h].label + " · " + hits[h].kind;
      item.appendChild(button);
      els.results.appendChild(item);
    }
  }

  function selectChange(changeId) {
    rvsMotionStop();
    var change = changeById[changeId];
    if (!change) return;
    state.change = changeId;
    state.focus = change.entity;
    describeChange(change);
    describeEvidence(change);
    paint();
    var routes = rvsRoutesForChange(model, changeId);
    var presence = rvsPanelPresence(model, change.entity);
    say(
      "Selected " + change.type + " change on " + ((model.entities[change.entity] || {}).label || change.entity) +
      ". Present in before: " + (presence.before ? "yes" : "no") +
      ". Present in after: " + (presence.after ? "yes" : "no") +
      ". Routes recorded: " + routes.length + "."
    );

    // Step along the causal chain -- but only a confirmed one.
    //
    // §44 is explicit that an unresolved causal path must not be animated as
    // confirmed propagation, and motion is the most confident thing a page
    // can do: watching emphasis travel from one entity to the next reads as
    // "this caused that" no matter what the legend says. The static view
    // still draws related and unresolved routes, distinctly and with their
    // own line treatment; what it does not do is march along them.
    var confirmed = null;
    for (var r = 0; r < routes.length; r++) {
      if (routes[r].kind === "confirmed") { confirmed = routes[r]; break; }
    }
    if (confirmed && confirmed.entities.length > 1) {
      rvsMotionPlay(
        rvsBuildMotionPlan({
          mode: "step",
          grammar: model.grammar || "delta",
          sequence: confirmed.entities
        }),
        motionTargets,
        say
      );
    }
  }

  function selectEntity(entityId) {
    rvsMotionStop();
    if (!nodeByEntity[entityId]) return;
    var changes = rvsChangesForEntity(model, entityId);
    if (changes.length > 0) {
      selectChange(changes[0].id);
      return;
    }
    state.change = null;
    state.focus = entityId;
    describeChange(null);
    describeEvidence(null);
    paint();
    var presence = rvsPanelPresence(model, entityId);
    say(
      "Selected " + nodeByEntity[entityId].label +
      ". No change was recorded against this entity. Present in before: " + (presence.before ? "yes" : "no") +
      ". Present in after: " + (presence.after ? "yes" : "no") + "."
    );
  }

  function applyLens(lensId) {
    rvsMotionStop();
    if (!lensById[lensId]) return;
    state.lens = lensId;
    if (els.caveat) els.caveat.textContent = lensById[lensId].caveat;
    renderChangeList();
    paint();
    say(
      "Lens: " + lensById[lensId].label +
      ". Nothing is hidden; entities outside the lens are de-emphasised. " + lensById[lensId].caveat
    );
  }

  function clearAll() {
    rvsMotionStop();
    state.change = null;
    state.focus = null;
    state.query = "";
    if (els.search) els.search.value = "";
    renderResults([]);
    describeChange(null);
    describeEvidence(null);
    paint();
    say("Selection cleared. Showing every entity in all three states.");
  }

  if (els.search) {
    els.search.addEventListener("input", function () {
      // Searching is an interaction like any other, and §50 says motion must
      // never compete with one.
      rvsMotionStop();
      state.query = els.search.value;
      renderResults(rvsSearchEntities(model, state.query, 50));
    });
  }
  if (els.results) {
    els.results.addEventListener("click", function (event) {
      var target = event.target.closest ? event.target.closest("[data-rvs-target]") : null;
      if (target) selectEntity(target.getAttribute("data-rvs-target"));
    });
  }
  if (els.changes) {
    els.changes.addEventListener("click", function (event) {
      var target = event.target.closest ? event.target.closest("[data-rvs-change]") : null;
      if (target) selectChange(target.getAttribute("data-rvs-change"));
    });
  }
  if (els.stage) {
    els.stage.addEventListener("click", function (event) {
      var group = event.target.closest ? event.target.closest("[data-rvs-node]") : null;
      if (group) selectEntity(group.getAttribute("data-rvs-node"));
    });
  }
  if (els.lens) {
    els.lens.addEventListener("change", function () { applyLens(els.lens.value); });
  }
  if (els.animate) {
    // "Animate what changed", from an explicit control.
    //
    // Never on load. A page that starts moving before it has been read makes
    // the reader wait to be allowed to read, and there is nothing in the
    // sequence that the change list does not already say in words. The button
    // is an offer, and pressing it a second time restarts rather than queues.
    els.animate.addEventListener("click", function () {
      var sequence = [];
      var seen = {};
      for (var c = 0; c < model.changes.length; c++) {
        var entity = model.changes[c].entity;
        if (seen[entity]) continue;
        seen[entity] = true;
        // Only entities the page can actually address. A change list names
        // edges as well as nodes, and an edge has no group of its own to
        // emphasise -- motionTargets would return nothing for it, so the
        // step would announce an entity while the drawing sat still. The
        // change list still shows it; the sweep just does not claim to be
        // pointing at it.
        if (!nodeByEntity[entity]) continue;
        sequence.push(entity);
      }
      // The order is the change list's order, which the model fixed upstream.
      // Nothing here re-ranks it: a reader watching the sweep and reading the
      // list must see the same order, or one of the two is lying.
      rvsMotionPlay(
        rvsBuildMotionPlan({
          mode: "compare",
          grammar: model.grammar || "delta",
          sequence: sequence,
          destination_announcement: sequence.length === 0
            ? "No entity changed between these snapshots."
            : "Compared " + sequence.length + " changed entities across before, delta and after."
        }),
        motionTargets,
        say
      );
    });
  }
  if (els.helpToggle && els.help) {
    els.helpToggle.addEventListener("click", function () {
      var open = els.help.hasAttribute("hidden");
      if (open) els.help.removeAttribute("hidden");
      else els.help.setAttribute("hidden", "");
      els.helpToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  document.addEventListener("keydown", function (event) {
    var typing = event.target && (event.target.tagName === "INPUT" || event.target.tagName === "SELECT");
    if (event.key === "Escape") {
      // Also the skip control: §50 requires a sequence be skippable, and this
      // is the key a reader already knows for "stop what you are doing".
      rvsMotionStop();
      clearAll();
      if (els.search) els.search.focus();
      return;
    }
    if (typing) {
      if (event.key === "ArrowDown" && els.results) {
        var first = els.results.querySelector("button");
        if (first) { first.focus(); event.preventDefault(); }
      }
      return;
    }
    if (event.key === "/") {
      if (els.search) els.search.focus();
      event.preventDefault();
    } else if (event.key === "?") {
      if (els.helpToggle) els.helpToggle.click();
      event.preventDefault();
    } else if (event.key >= "1" && event.key <= "6") {
      // Lens switching from the keyboard, in the order the lenses are listed.
      var chosen = model.lenses[Number(event.key) - 1];
      if (chosen && els.lens) {
        els.lens.value = chosen.id;
        applyLens(chosen.id);
        event.preventDefault();
      }
    }
  });

  renderResults([]);
  renderChangeList();
  describeChange(null);
  describeEvidence(null);
  applyLens(state.lens);
})();
`;

/**
 * The whole client script: the explorer's tested algorithms, the review's
 * tested algorithms, the shared motion layer, then the wiring that calls all
 * three.
 *
 * The motion halves come from @rvs/visual-grammar. Before 10.5 this file
 * sequenced its own emphasis with a locally-invented `rvs-compare-sweep`
 * class, which is exactly the renderer-invented visual behaviour §1 exists to
 * remove: the explorer and the review animated the same kind of event in two
 * different ways because two different files decided how.
 */
export const REVIEW_RUNTIME =
  `${EXPLORER_ALGORITHMS}\n${REVIEW_ALGORITHMS}\n${MOTION_ALGORITHMS}\n${MOTION_PLAYER}\n${REVIEW_RUNTIME_WIRING}`;
