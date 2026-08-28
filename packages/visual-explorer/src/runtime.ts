// The browser runtime, authored as text.
//
// It is split in two deliberately. `EXPLORER_ALGORITHMS` is pure: the same
// search, reach, route and lens logic as `interaction.ts`, with no reference
// to `document`, `window`, `fetch`, or any other host object. A test runs it
// in an isolated VM against the same fixtures as the TypeScript version and
// asserts the two agree -- which is what stops the browser copy from drifting
// into a second, untested implementation of the explorer's semantics.
//
// `EXPLORER_RUNTIME_WIRING` is the part that touches the page. It reads a
// JSON island, sets classes, and moves focus. It never constructs markup from
// data: every insertion goes through `textContent` or `createElement`, so a
// hostile label is text at every point and can never become an element.
//
// What neither half does, at all: no `eval`, no `new Function`, no `fetch`,
// no `XMLHttpRequest`, no `WebSocket`, no dynamic `import`, no navigation.
// The artifact is a file on disk that works with the network unplugged.

import { MOTION_ALGORITHMS, MOTION_PLAYER } from "@rvs/visual-grammar";

export const EXPLORER_ALGORITHMS = String.raw`
"use strict";

function rvsNormalizeIds(ids) {
  return Array.from(new Set(ids)).sort();
}

function rvsSearchEntities(model, query, limit) {
  var needle = String(query || "").trim().toLowerCase();
  if (needle === "") return [];
  var hits = [];
  for (var i = 0; i < model.nodes.length; i++) {
    var node = model.nodes[i];
    if (node.placeholder) continue;
    var label = String(node.label).toLowerCase();
    var id = String(node.entity).toLowerCase();
    var rank = -1;
    if (label === needle || id === needle) rank = 0;
    else if (label.indexOf(needle) === 0) rank = 1;
    else if (label.indexOf(needle) >= 0) rank = 2;
    else if (id.indexOf(needle) >= 0) rank = 3;
    if (rank < 0) continue;
    hits.push({ node_id: node.id, source_entity_id: node.entity, label: node.label, kind: node.kind, rank: rank });
  }
  hits.sort(function (a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.node_id < b.node_id ? -1 : 1;
  });
  return hits.slice(0, limit === undefined ? 50 : limit);
}

function rvsAdjacency(model, direction) {
  var out = {};
  var push = function (from, to, edge) {
    if (!out[from]) out[from] = [];
    out[from].push({ to: to, edge: edge });
  };
  for (var i = 0; i < model.edges.length; i++) {
    var e = model.edges[i];
    if (direction === "downstream" || direction === "both") push(e.from, e.to, e.id);
    if (direction === "upstream" || direction === "both") push(e.to, e.from, e.id);
  }
  for (var key in out) {
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      out[key].sort(function (a, b) { return a.edge < b.edge ? -1 : 1; });
    }
  }
  return out;
}

function rvsReachFrom(model, originId, direction, maxDepth) {
  var known = {};
  for (var i = 0; i < model.nodes.length; i++) known[model.nodes[i].id] = true;
  if (!known[originId]) return { node_ids: [], edge_ids: [], depth_of: {}, truncated: false };
  var limit = Math.max(0, maxDepth === undefined ? 2 : maxDepth);
  var adjacency = rvsAdjacency(model, direction || "downstream");
  var depthOf = {};
  depthOf[originId] = 0;
  var edges = {};
  var frontier = [originId];
  for (var depth = 1; depth <= limit; depth++) {
    var next = [];
    for (var f = 0; f < frontier.length; f++) {
      var steps = adjacency[frontier[f]] || [];
      for (var s = 0; s < steps.length; s++) {
        edges[steps[s].edge] = true;
        if (depthOf[steps[s].to] !== undefined) continue;
        depthOf[steps[s].to] = depth;
        next.push(steps[s].to);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  var truncated = false;
  for (var t = 0; t < frontier.length; t++) {
    var beyond = adjacency[frontier[t]] || [];
    for (var b = 0; b < beyond.length; b++) {
      if (depthOf[beyond[b].to] === undefined) truncated = true;
    }
  }
  return {
    node_ids: rvsNormalizeIds(Object.keys(depthOf)),
    edge_ids: rvsNormalizeIds(Object.keys(edges)),
    depth_of: depthOf,
    truncated: truncated
  };
}

function rvsTraceRoute(model, fromId, toId, direction) {
  var known = {};
  for (var i = 0; i < model.nodes.length; i++) known[model.nodes[i].id] = true;
  if (!known[fromId] || !known[toId]) return { node_ids: [], edge_ids: [], found: false };
  if (fromId === toId) return { node_ids: [fromId], edge_ids: [], found: true };
  var adjacency = rvsAdjacency(model, direction || "downstream");
  var cameFrom = {};
  var seen = {};
  seen[fromId] = true;
  var frontier = [fromId];
  while (frontier.length > 0) {
    var next = [];
    for (var f = 0; f < frontier.length; f++) {
      var steps = adjacency[frontier[f]] || [];
      for (var s = 0; s < steps.length; s++) {
        var step = steps[s];
        if (seen[step.to]) continue;
        seen[step.to] = true;
        cameFrom[step.to] = { node: frontier[f], edge: step.edge };
        if (step.to === toId) {
          var nodeIds = [toId];
          var edgeIds = [];
          var cursor = toId;
          while (cursor !== fromId) {
            var prev = cameFrom[cursor];
            nodeIds.unshift(prev.node);
            edgeIds.unshift(prev.edge);
            cursor = prev.node;
          }
          return { node_ids: nodeIds, edge_ids: edgeIds, found: true };
        }
        next.push(step.to);
      }
    }
    frontier = next;
  }
  return { node_ids: [], edge_ids: [], found: false };
}

function rvsMatchesLens(node, lens) {
  if (lens === "governance") return node.severity !== undefined && node.severity !== null;
  if (lens === "decisions") return node.decision !== undefined && node.decision !== null;
  if (lens === "unresolved") return node.resolution !== "resolved" || node.confidence !== "confirmed";
  if (lens === "evidence") return node.evidence > 0;
  return true;
}

function rvsMutedNodeIds(model, lens, focusNodeIds) {
  var focus = null;
  if (focusNodeIds) {
    focus = {};
    for (var i = 0; i < focusNodeIds.length; i++) focus[focusNodeIds[i]] = true;
  }
  var muted = [];
  for (var n = 0; n < model.nodes.length; n++) {
    var node = model.nodes[n];
    if (node.emphasis === "focal") continue;
    var inLens = rvsMatchesLens(node, lens);
    var inFocus = focus === null || focus[node.id] === true;
    if (!inLens || !inFocus) muted.push(node.id);
  }
  return rvsNormalizeIds(muted);
}
`;

/**
 * The page wiring.
 *
 * Kept separate from the algorithms above so the untestable half is as small
 * as it can be: this is class-setting, focus-moving, and text-writing, and
 * nothing else.
 */
export const EXPLORER_RUNTIME_WIRING = String.raw`
(function () {
  "use strict";

  var island = document.getElementById("rvs-model");
  if (!island) return;
  var model;
  try {
    model = JSON.parse(island.textContent || "{}");
  } catch (error) {
    return;
  }
  var nodeById = {};
  for (var i = 0; i < model.nodes.length; i++) nodeById[model.nodes[i].id] = model.nodes[i];

  var els = {
    search: document.getElementById("rvs-search"),
    results: document.getElementById("rvs-results"),
    lens: document.getElementById("rvs-lens"),
    direction: document.getElementById("rvs-direction"),
    depth: document.getElementById("rvs-depth"),
    routeTo: document.getElementById("rvs-route-to"),
    clear: document.getElementById("rvs-clear"),
    status: document.getElementById("rvs-status"),
    inspector: document.getElementById("rvs-inspector"),
    help: document.getElementById("rvs-help"),
    helpToggle: document.getElementById("rvs-help-toggle"),
    stage: document.getElementById("rvs-stage")
  };

  var state = { focus: null, routeTo: null, lens: "none", direction: "downstream", depth: 2, query: "" };

  function say(message) {
    if (els.status) els.status.textContent = message;
  }

  function setClasses(muted, reached, route) {
    var groups = els.stage ? els.stage.querySelectorAll("[data-rvs-node]") : [];
    for (var g = 0; g < groups.length; g++) {
      var id = groups[g].getAttribute("data-rvs-node");
      groups[g].classList.toggle("rvs-muted", muted[id] === true);
      groups[g].classList.toggle("rvs-reached", reached[id] === true);
      groups[g].classList.toggle("rvs-focus", state.focus === id);
    }
    var edges = els.stage ? els.stage.querySelectorAll("[data-rvs-edge]") : [];
    for (var e = 0; e < edges.length; e++) {
      edges[e].classList.toggle("rvs-route", route[edges[e].getAttribute("data-rvs-edge")] === true);
    }
  }

  function asSet(list) {
    var out = {};
    for (var i = 0; i < list.length; i++) out[list[i]] = true;
    return out;
  }

  /**
   * The elements a motion target id addresses.
   *
   * One resolver for both node ids and edge ids: a trace plan names edges, an
   * impact plan names nodes, and the player should not have to know which
   * kind of plan it is holding.
   */
  function motionTargets(id) {
    if (!els.stage) return [];
    var escaped = rvsMotionEscape(id);
    return els.stage.querySelectorAll('[data-rvs-node="' + escaped + '"], [data-rvs-edge="' + escaped + '"]');
  }

  function describe(node) {
    if (!els.inspector) return;
    while (els.inspector.firstChild) els.inspector.removeChild(els.inspector.firstChild);
    if (!node) {
      var empty = document.createElement("p");
      empty.className = "rvs-empty";
      empty.textContent = "Select an entity to inspect it.";
      els.inspector.appendChild(empty);
      return;
    }
    var heading = document.createElement("h3");
    heading.textContent = node.label;
    els.inspector.appendChild(heading);

    var rows = [
      ["Identifier", node.entity],
      ["Kind", node.kind],
      ["Resolution", node.resolution],
      ["Confidence", node.confidence],
      ["Governance severity", node.severity || "none recorded"],
      ["Decision status", node.decision || "none recorded"]
    ];
    var list = document.createElement("dl");
    for (var r = 0; r < rows.length; r++) {
      var dt = document.createElement("dt");
      dt.textContent = rows[r][0];
      var dd = document.createElement("dd");
      dd.textContent = rows[r][1];
      list.appendChild(dt);
      list.appendChild(dd);
    }
    els.inspector.appendChild(list);

    var evidenceHeading = document.createElement("h4");
    evidenceHeading.textContent = "Evidence references (" + node.evidence + ")";
    els.inspector.appendChild(evidenceHeading);
    var refs = document.createElement("ul");
    if (node.evidence_refs && node.evidence_refs.length > 0) {
      for (var v = 0; v < node.evidence_refs.length; v++) {
        var li = document.createElement("li");
        // Text, never a link. An evidence reference is a repository-relative
        // location for a person to open in their editor; turning it into
        // something the page can follow is exactly what this artifact must
        // not do.
        li.textContent = node.evidence_refs[v];
        refs.appendChild(li);
      }
    } else {
      var none = document.createElement("li");
      none.textContent = "No evidence reference was recorded upstream.";
      refs.appendChild(none);
    }
    els.inspector.appendChild(refs);
  }

  function renderResults(hits) {
    if (!els.results) return;
    while (els.results.firstChild) els.results.removeChild(els.results.firstChild);
    if (hits.length === 0) {
      var li = document.createElement("li");
      li.className = "rvs-empty";
      li.textContent = state.query === "" ? "Type to search entities." : "No entity matched.";
      els.results.appendChild(li);
      return;
    }
    for (var h = 0; h < hits.length; h++) {
      var item = document.createElement("li");
      var button = document.createElement("button");
      button.type = "button";
      button.className = "rvs-result";
      button.setAttribute("data-rvs-target", hits[h].node_id);
      button.textContent = hits[h].label + " · " + hits[h].kind;
      item.appendChild(button);
      els.results.appendChild(item);
    }
  }

  function apply() {
    // Every state change abandons whatever was playing. This is the whole of
    // section 50's interruptibility: a reader who changes lens, depth, direction or
    // focus mid-sequence has invalidated it, and the queued steps find their
    // generation stale.
    rvsMotionStop();

    var reached = {};
    var route = {};
    var plan = null;
    if (state.focus) {
      var reach = rvsReachFrom(model, state.focus, state.direction, state.depth);
      reached = asSet(reach.node_ids);
      if (state.routeTo) {
        var traced = rvsTraceRoute(model, state.focus, state.routeTo, state.direction);
        route = asSet(traced.edge_ids);
        for (var t = 0; t < traced.node_ids.length; t++) reached[traced.node_ids[t]] = true;
        var destination = nodeById[state.routeTo] ? nodeById[state.routeTo].label : state.routeTo;
        var routeMessage = traced.found
          ? "Route to " + destination + " found across " + traced.edge_ids.length + " relationship(s)."
          : "No route to " + destination + " exists in this direction.";
        say(routeMessage);
        if (traced.found) {
          // §47: the motion layer does not choose the route. rvsTraceRoute
          // already chose it, in order, and the plan traces exactly the edges
          // it returned -- no more, no differently ordered, and none if it
          // found nothing.
          //
          // The destination announcement is the sentence the status line
          // already carries. Writing the same string again at the end of the
          // sequence changes nothing, which is the point: the trace tells a
          // reader nothing the static page did not already say, so a reader
          // who never sees it has lost no information.
          plan = rvsBuildMotionPlan({
            mode: "trace",
            grammar: model.grammar || "dependency_graph",
            sequence: traced.edge_ids,
            destination_announcement: routeMessage
          });
        }
      } else {
        say("Focused " + nodeById[state.focus].label + ": " + reach.node_ids.length +
          " entities within " + state.depth + " hop(s)" + (reach.truncated ? ", more beyond." : "."));
        // The fan outward from the focus, one hop at a time. The depths are
        // the traversal's own -- §48 forbids inventing an intermediate the
        // graph could not produce, and nothing here adds one.
        plan = rvsBuildMotionPlan({
          mode: "impact",
          grammar: model.grammar || "dependency_graph",
          rings: rvsMotionRingsFromDepths(reach.depth_of)
        });
      }
    } else if (state.lens !== "none") {
      say("Lens applied. Nothing is hidden; entities outside the lens are de-emphasised.");
    } else {
      say("Showing every entity in the view.");
    }
    var focusList = state.focus ? Object.keys(reached) : null;
    var muted = asSet(rvsMutedNodeIds(model, state.lens, focusList));
    setClasses(muted, reached, route);

    // Played last, so the static state is already correct before anything
    // moves. The page's own say() is passed in rather than re-implemented,
    // so there is one live region on this page and not two.
    if (plan) rvsMotionPlay(plan, motionTargets, say);
  }

  function focusNode(nodeId) {
    if (!nodeById[nodeId]) return;
    state.focus = nodeId;
    describe(nodeById[nodeId]);
    apply();
  }

  function clearAll() {
    state.focus = null;
    state.routeTo = null;
    state.lens = "none";
    state.query = "";
    if (els.search) els.search.value = "";
    if (els.lens) els.lens.value = "none";
    if (els.routeTo) els.routeTo.value = "";
    renderResults([]);
    describe(null);
    apply();
  }

  if (els.search) {
    els.search.addEventListener("input", function () {
      // Searching is not a state change apply() handles, but it is still an
      // interaction, and §50 says motion must never compete with one.
      rvsMotionStop();
      state.query = els.search.value;
      renderResults(rvsSearchEntities(model, state.query, 50));
    });
  }
  if (els.results) {
    els.results.addEventListener("click", function (event) {
      var target = event.target.closest ? event.target.closest("[data-rvs-target]") : null;
      if (target) focusNode(target.getAttribute("data-rvs-target"));
    });
  }
  if (els.stage) {
    els.stage.addEventListener("click", function (event) {
      var group = event.target.closest ? event.target.closest("[data-rvs-node]") : null;
      if (group) focusNode(group.getAttribute("data-rvs-node"));
    });
  }
  if (els.lens) {
    els.lens.addEventListener("change", function () {
      state.lens = els.lens.value;
      apply();
    });
  }
  if (els.direction) {
    els.direction.addEventListener("change", function () {
      state.direction = els.direction.value;
      apply();
    });
  }
  if (els.depth) {
    els.depth.addEventListener("change", function () {
      var value = parseInt(els.depth.value, 10);
      state.depth = isNaN(value) ? 2 : Math.max(0, Math.min(6, value));
      els.depth.value = String(state.depth);
      apply();
    });
  }
  if (els.routeTo) {
    els.routeTo.addEventListener("change", function () {
      state.routeTo = els.routeTo.value === "" ? null : els.routeTo.value;
      apply();
    });
  }
  if (els.clear) els.clear.addEventListener("click", clearAll);
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
      // Also the skip control. §50 requires a sequence be skippable, and the
      // key a reader already knows for "stop what you are doing" is the one
      // to spend rather than a second one to learn.
      rvsMotionStop();
      clearAll();
      if (els.search) els.search.focus();
      return;
    }
    if (typing) {
      if (event.key === "ArrowDown" && els.results) {
        var first = els.results.querySelector("button");
        if (first) {
          first.focus();
          event.preventDefault();
        }
      }
      return;
    }
    if (event.key === "/") {
      if (els.search) els.search.focus();
      event.preventDefault();
    } else if (event.key === "?") {
      if (els.helpToggle) els.helpToggle.click();
      event.preventDefault();
    }
  });

  renderResults([]);
  describe(null);
  apply();
})();
`;

/**
 * The whole client script: the tested algorithms, the shared motion layer,
 * then the wiring that calls them.
 *
 * The motion halves come from @rvs/visual-grammar rather than being written
 * again here. §55 puts motion hooks with the shared primitives, and the
 * alternative -- an explorer that sequences its own emphasis -- is precisely
 * the renderer-invented visual behaviour §1 exists to remove.
 */
export const EXPLORER_RUNTIME =
  `${EXPLORER_ALGORITHMS}\n${MOTION_ALGORITHMS}\n${MOTION_PLAYER}\n${EXPLORER_RUNTIME_WIRING}`;
