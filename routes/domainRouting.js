const fs = require('fs');
const path = require('path');

const ROUTING_FILE = path.join(__dirname, '../data/domainRouting.json');

let domainRouting = {};

// Load routing data from the JSON file
function loadRouting() {
    if (fs.existsSync(ROUTING_FILE)) {
        const data = fs.readFileSync(ROUTING_FILE, 'utf8');
        domainRouting = JSON.parse(data);
    } else {
        domainRouting = {};
    }
}

// Save routing data to the JSON file
function saveRouting() {
    fs.writeFileSync(ROUTING_FILE, JSON.stringify(domainRouting, null, 2), 'utf8');
}

// Initialize routing data on module load
loadRouting();

// Get all routing entries
function getAll() {
    return domainRouting;
}

// Get a specific routing entry by domain
function get(domain) {
    return domainRouting[domain] || null;
}

// Add or update a routing entry
function set(domain, target) {
    domainRouting[domain] = target;
    saveRouting();
}

// Remove a routing entry
function remove(domain) {
    if (domainRouting[domain]) {
        delete domainRouting[domain];
        saveRouting();
        return true;
    }
    return false;
}

module.exports = {
    getAll,
    get,
    set,
    remove
};
