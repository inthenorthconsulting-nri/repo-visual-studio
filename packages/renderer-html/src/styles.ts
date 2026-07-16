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
