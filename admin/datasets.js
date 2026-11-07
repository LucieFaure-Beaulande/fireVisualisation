// The datasets managed by the admin console
//
// To manage another dataset from the console, add an entry to this list.
// To recompute the data of a visualization after a change (e.g. a pipeline), add a command to afterChange.
// See the README, section "Admin console".
// The paths are relative to the root of the project.

module.exports = [
    {
        id: 'fires',
        label: 'Fires in Oregon (Oregon Department of Forestry)',

        // the original file, never modified
        original: 'public/data/fire-occurence.csv',

        // the files added from the console, kept on the server (not in the git repository)
        additions: 'data/additions/fires',

        // the file built by the server: original + added files, without duplicates
        // this is the file read by loadFires() (public/js/fireData.js)
        current: 'public/data/fires-current.csv',

        // the column that identifies a row, and the column that tells which version of a row is the newest
        key: 'Serial',
        newest: 'ModifiedDate',
        dateFormat: '%m/%d/%Y %I:%M:%S %p',

        // the column of the years, used to describe the content of the files
        year: 'FireYear',

        // a file without one of these columns is refused
        required: ['Serial', 'FireYear', 'HumanOrLightning', 'GeneralCause', 'SpecificCause', 'EstTotalAcres',
            'County', 'ReportDateTime'],

        // the visualizations that read this dataset, linked from the console
        usedBy: [
            { label: 'Sunburst of the causes', url: '/sunburst/' },
            { label: 'Bullet graph', url: '/bulletgraph/' }
        ],

        // the commands run after each change, in this order
        afterChange: [
            { label: 'Bubble map data', command: 'node', args: ['scripts/prepare-data.mjs'], folder: '.' }
        ]
    }
]
