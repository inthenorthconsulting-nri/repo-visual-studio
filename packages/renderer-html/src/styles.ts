export const BASE_CSS = `
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    height: 100%;
    background: #000;
    font-family: var(--rvs-font-body);
    color: var(--rvs-color-text-primary);
  }
  .stage-viewport {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: var(--rvs-color-background);
  }
  .stage {
    position: relative;
    width: 1280px;
    height: 720px;
    background: var(--rvs-color-background);
    transform-origin: center center;
  }
  .scene {
    position: absolute;
    inset: 0;
    width: 1280px;
    height: 720px;
    padding: 72px 96px;
    display: flex;
    flex-direction: column;
    background: var(--rvs-color-background);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--rvs-motion-normal) ease;
  }
  .scene.is-active {
    opacity: 1;
    pointer-events: auto;
  }
  .scene-inner {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  @media (prefers-reduced-motion: reduce) {
    .scene { transition: none; }
  }
  h1 { font-family: var(--rvs-font-heading); font-size: 44px; line-height: 1.2; margin: 0 0 24px; }
  .display { font-family: var(--rvs-font-display); font-size: 64px; }
  p, li { font-size: 22px; line-height: 1.5; color: var(--rvs-color-text-secondary); }

  .scene-title { text-align: left; }
  .scene-title .subheadline { font-size: 26px; color: var(--rvs-color-text-secondary); margin-top: 16px; }

  .scene-divider { display: flex; flex-direction: column; gap: 16px; }
  .divider-index { font-family: var(--rvs-font-code); font-size: 20px; color: var(--rvs-color-accent); letter-spacing: 0.1em; }

  .body-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
  .body-list li::before { content: "\\2013\\00a0\\00a0"; color: var(--rvs-color-accent); }

  .metric-grid {
    display: grid;
    grid-template-columns: repeat(var(--metric-count, 3), 1fr);
    gap: 32px;
    margin-top: 24px;
  }
  .metric-item { display: flex; flex-direction: column; gap: 8px; border-left: 3px solid var(--rvs-color-accent); padding-left: 16px; }
  .metric-value { font-family: var(--rvs-font-heading); font-size: 48px; font-weight: 700; color: var(--rvs-color-text-primary); }
  .metric-label { font-size: 18px; color: var(--rvs-color-text-secondary); }

  .architecture-svg { width: 100%; flex: 1; margin-top: 16px; }
  .architecture-node rect { fill: var(--rvs-color-surface); stroke: var(--rvs-color-border); stroke-width: 2; }
  .architecture-node text { font-family: var(--rvs-font-body); font-size: 18px; fill: var(--rvs-color-text-primary); }
  .architecture-edge { stroke: var(--rvs-color-accent); stroke-width: 2; }

  .scene-workflow { display: flex; flex-direction: column; min-height: 0; }
  .workflow-svg-wrap { flex: 1; min-height: 0; overflow: auto; display: flex; align-items: flex-start; }
  .workflow-svg-wrap svg { max-width: 100%; height: auto; }
  .workflow-annotations { list-style: none; padding: 0; margin: 16px 0 0; display: flex; flex-direction: column; gap: 6px; }
  .workflow-annotations code { font-family: var(--rvs-font-code); font-size: 14px; color: var(--rvs-color-accent); }

  .scene-topology { display: flex; flex-direction: column; min-height: 0; }
  .topology-svg-wrap { flex: 1; min-height: 0; overflow: auto; display: flex; align-items: flex-start; }
  .topology-svg-wrap svg { max-width: 100%; height: auto; }

  .scene-arch-executive-title { display: flex; flex-direction: column; justify-content: center; gap: 20px; }
  .arch-subheadline { font-size: 26px; color: var(--rvs-color-text-secondary); margin: 0; }

  .scene-arch-text, .scene-arch-diagram { display: flex; flex-direction: column; min-height: 0; gap: 8px; }
  .arch-subheading { font-family: var(--rvs-font-heading); font-size: 20px; margin: 0 0 8px; color: var(--rvs-color-text-primary); }
  .arch-empty { font-style: italic; }

  .arch-statement-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
  .arch-statement { font-size: 20px; line-height: 1.4; }
  .arch-statement::before { content: "\\2013\\00a0\\00a0"; color: var(--rvs-color-accent); }
  .arch-statement-qualified { font-style: italic; opacity: 0.9; }
  .arch-evidence { font-family: var(--rvs-font-code); font-size: 13px; color: var(--rvs-color-text-secondary); opacity: 0.75; margin-left: 4px; font-style: normal; }
  .arch-flow-list { margin-top: 16px; max-height: 160px; }

  .arch-severity { display: inline-block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 8px; border-radius: 999px; margin-right: 8px; font-family: var(--rvs-font-body); }
  .arch-severity-high { background: rgba(220, 60, 60, 0.2); color: #ff8080; }
  .arch-severity-medium { background: rgba(220, 170, 60, 0.2); color: #ffcf70; }
  .arch-severity-low { background: rgba(120, 160, 220, 0.2); color: #9dc0ff; }

  .arch-operating-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px 40px; overflow-y: auto; }
  .arch-operating-group .arch-statement-list { overflow-y: visible; }

  .arch-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; overflow-y: auto; }
  .arch-card { border: 1px solid var(--rvs-color-border); border-radius: 8px; padding: 16px 20px; background: var(--rvs-color-surface); }
  .arch-card-title { font-family: var(--rvs-font-heading); font-size: 20px; margin: 0 0 8px; color: var(--rvs-color-text-primary); }
  .arch-card-kind { font-size: 14px; font-weight: 400; color: var(--rvs-color-text-secondary); text-transform: uppercase; letter-spacing: 0.04em; }
  .arch-card p { margin: 0 0 6px; font-size: 16px; }
  .arch-card-meta { font-size: 14px; color: var(--rvs-color-text-secondary); opacity: 0.85; }

  .arch-confidence-bar { display: flex; width: 100%; height: 28px; border-radius: 6px; overflow: hidden; margin-top: 16px; }
  .arch-confidence-segment { height: 100%; }
  .arch-confidence-confirmed { background: var(--rvs-color-success, #3ba55c); }
  .arch-confidence-derived { background: var(--rvs-color-accent); }
  .arch-confidence-suggested { background: var(--rvs-color-warning, #d9a441); }
  .arch-confidence-unresolved { background: var(--rvs-color-border); }
  .arch-confidence-legend { list-style: none; margin: 16px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 24px; font-size: 15px; }
  .arch-confidence-swatch { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 8px; vertical-align: middle; }

  .cap-overview { overflow-y: auto; }
  .cap-summary-line { font-size: 18px; color: var(--rvs-color-text-secondary); margin: 0 0 12px; }
  .cap-domain { margin-bottom: 20px; }
  .cap-card-grid { gap: 16px; }
  .cap-card-title { font-family: var(--rvs-font-heading); font-size: 18px; margin: 0 0 8px; color: var(--rvs-color-text-primary); }
  .cap-card-badges { margin: 0 0 8px; display: flex; flex-wrap: wrap; gap: 6px; }
  .cap-badge { display: inline-block; font-size: 14px; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 999px; background: var(--rvs-color-border); color: var(--rvs-color-text-secondary); }
  .cap-badge-status { background: var(--rvs-color-accent); color: var(--rvs-color-text-primary); }
  .cap-badge-confidence { background: rgba(120, 160, 220, 0.2); color: #9dc0ff; }
  .cap-badge-qualified { background: rgba(220, 170, 60, 0.2); color: #ffcf70; }
  .cap-card-purpose { font-size: 14px; margin: 0; }
  .cap-card-meta { font-size: 14px; color: var(--rvs-color-text-secondary); opacity: 0.85; margin: 6px 0 0; }
  .cap-gaps { margin-top: 12px; }
  .cap-limitations-note { margin-top: 16px; }

  .citations {
    position: absolute;
    left: 96px;
    right: 96px;
    bottom: 32px;
    border-top: 1px solid var(--rvs-color-border);
    padding-top: 8px;
  }
  .citations-heading { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--rvs-color-text-secondary); margin: 0 0 4px; font-family: var(--rvs-font-body); }
  .citations ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 16px; }
  .citations li { font-size: 13px; color: var(--rvs-color-text-secondary); }
  .citations cite { font-family: var(--rvs-font-code); font-style: normal; color: var(--rvs-color-accent); }
  .citation-confidence { opacity: 0.7; }

  .controls {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 16px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    padding: 8px 16px;
    border-radius: 999px;
    font-family: system-ui, sans-serif;
    font-size: 14px;
    z-index: 10;
  }
  .controls button {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.4);
    color: #fff;
    border-radius: 999px;
    width: 28px;
    height: 28px;
    cursor: pointer;
  }
  .controls button:focus-visible,
  .scene:focus-visible {
    outline: 2px solid var(--rvs-color-accent);
    outline-offset: 2px;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  @media print {
    .stage-viewport { position: static; display: block; overflow: visible; background: var(--rvs-color-background); }
    .stage { position: static; width: auto; height: auto; transform: none !important; }
    .controls { display: none; }
    .scene {
      position: static;
      opacity: 1 !important;
      pointer-events: auto;
      page-break-after: always;
      width: 1280px;
      height: 720px;
    }
  }

  body.rvs-print-preview .stage-viewport { position: static; display: block; overflow: visible; }
  body.rvs-print-preview .stage { position: static; width: auto; height: auto; transform: none !important; }
  body.rvs-print-preview .scene {
    position: static;
    opacity: 1 !important;
    pointer-events: auto;
    width: 1280px;
    height: 720px;
  }
`;
