// First transformation of the fire occurrence dataset, shared by all the visualizations
// raw data (csv file, where all values are strings) → data table (array of fire objects)

// the dataset loaded by default, it can be replaced by any csv file with the same columns
let defaultDataset = '/data/fire-occurence.csv'

// the format of the dates in the csv file, e.g. "07/19/2000 01:15:00 PM"
let parseDateTime = d3.timeParse('%m/%d/%Y %I:%M:%S %p')

// the value used to replace the empty cells of the categorical columns
let unspecified = 'Unspecified'

// the columns converted to numbers, null when the cell is empty
let numberColumns = ['Serial', 'FireYear', 'EstTotalAcres', 'Protected_Acres', 'Lat_DD', 'Long_DD']

// the columns converted to Date objects, null when the cell is empty
let dateColumns = ['Ign_DateTime', 'ReportDateTime', 'Discover_DateTime', 'Control_DateTime', 'CreationDate', 'ModifiedDate']

// the columns used to group the fires, "Unspecified" when the cell is empty
let categoryColumns = ['Area', 'DistrictName', 'UnitName', 'Size_class', 'HumanOrLightning', 'CauseBy',
    'GeneralCause', 'SpecificCause', 'FO_LandOwnType', 'County', 'RegUseZone', 'RegUseRestriction',
    'Industrial_Restriction']

// the columns removed because they have the same value for all the fires
let ignoredColumns = ['FireCategory']

// all the other columns (names, codes, comments) are kept as text, null when the cell is empty

// transform a row of the csv file into a fire object
function parseFire(d) {
    let fire = {}

    Object.keys(d).forEach(column => {
        let value = d[column].trim()

        if (ignoredColumns.includes(column)) return

        if (numberColumns.includes(column)) fire[column] = value === '' ? null : +value
        else if (dateColumns.includes(column)) fire[column] = parseDateTime(value)
        else if (categoryColumns.includes(column)) fire[column] = value === '' ? unspecified : value
        else fire[column] = value === '' ? null : value
    })

    return fire
}

// load a csv file of fires, returns a promise of an array of fire objects
function loadFires(url) {
    return d3.csv(url || defaultDataset, parseFire)
}
