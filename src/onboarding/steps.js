function target(selector, fallback = 'body') {
  return () => document.querySelector(selector) || document.querySelector(fallback) || document.body;
}

export const FIRST_TIME_TOUR_STEPS = [
  {
    popover: {
      title: 'Welcome',
      description:
        'This tour introduces the main ways to explore Neotoma taxonomy: browse the hierarchy, search taxa, inspect results, check synonyms, and compare two taxa.',
      side: 'bottom',
      align: 'center',
    },
  },
  {
    element: target('#stage'),
    popover: {
      title: 'Click a Taxon',
      description:
        'Start by clicking a taxon in the visualizer. The path you click is highlighted in blue, and <strong>Search Results</strong> shows its path from root to taxon plus available metadata.',
      side: 'right',
      align: 'center',
    },
  },
  {
    element: target('.taxon-group-search-row', '#controls'),
    popover: {
      title: 'Two-Level Visualization',
      description:
        'By default, the visualizer opens in <strong>Major Groups View</strong>, which shows the broad taxonomic hierarchy down to class level. To drill into species-level detail, choose a group from the <strong>Taxon Group</strong> dropdown, or click a <span class="onboarding-anchor-text">green anchor node</span> in Major Groups View and select the <span class="onboarding-action-button">Go to Group View</span> button in the panel.',
      side: 'top',
      align: 'center',
    },
  },
  {
    element: target('#visualizerControlBox', '#stage'),
    popover: {
      title: 'Control Panel',
      description:
        'Use rotate, zoom, reset, Whole View, and Focus View to navigate the tree. This control box can also be dragged or collapsed.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: target('.taxon-type-row', '#controls'),
    popover: {
      title: 'Taxon Type',
      description:
        'Use Taxon Type to switch between biological and non-biological taxa. The available Taxon Groups update based on this choice.',
      side: 'left',
      align: 'center',
    },
  },
  {
    element: target('.search-section', '#sidebar'),
    popover: {
      title: 'Search, Results, and Synonyms',
      description:
        'Search by taxon name or id. If a word, such as <strong>bison</strong>, appears in multiple taxa, all matching paths are highlighted in blue. If a match comes from a Neotoma synonym record, the path is highlighted in orange.',
      side: 'left',
      align: 'center',
    },
  },
  {
    element: target('.search-section', '#sidebar'),
    popover: {
      title: 'Compare Two Taxa',
      description:
        'Use a comma to compare two exact taxa, for example <strong>cf. Bison latifrons, cf. Bison alaskensis</strong>. If either side matches multiple taxa, choose the exact taxon first before comparing.',
      side: 'left',
      align: 'center',
    },
  },
];
