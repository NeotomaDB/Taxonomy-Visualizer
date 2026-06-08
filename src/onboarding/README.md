# Onboarding

First-time product tour for the Neotoma Hierarchical Taxonomy Visualizer.

- `steps.js` contains the seven first-time tour steps.
- `state.js` stores completed/skipped state in `localStorage`.
- `onboarding.js` initializes Driver.js and exposes `window.NeotomaOnboarding.start()`.
- `onboarding.css` themes Driver.js popovers for this app.

The first-time tour auto-starts once unless the user skips or completes it. Users can replay it from the top-right `Take Tour` menu item.
