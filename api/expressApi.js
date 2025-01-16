require('dotenv').config(); // Load environment variables

const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan'); // For logging
const domainRouting = require('../routes/domainRouting');
const tcpProxy = require('../server/tcpProxy');

const app = express();
const PORT = process.env.API_PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(morgan('combined')); // Optional: Logs HTTP requests

// API Key Authentication Middleware
function authenticateApiKey(req, res, next) {
    const authHeader = req.headers['x-api-key'];
    if (!authHeader) {
        return res.status(401).json({ error: 'No API key provided' });
    }

    if (authHeader !== process.env.API_KEY) {
        return res.status(403).json({ error: 'Invalid API key' });
    }

    next();
}

// Apply the authentication middleware to all routes
app.use(authenticateApiKey);

// Routes

// Get all routing entries
app.get('/api/routing', (req, res) => {
    res.json(domainRouting.getAll());
});

// Get a specific routing entry
app.get('/api/routing/:domain', (req, res) => {
    const domain = req.params.domain;
    const target = domainRouting.get(domain);
    if (target) {
        res.json({ domain, target });
    } else {
        res.status(404).json({ error: 'Domain not found' });
    }
});

// Add or update a routing entry
app.post('/api/routing', (req, res) => {
    const { domain, host, port } = req.body;
    if (!domain || !host || !port) {
        return res.status(400).json({ error: 'domain, host, and port are required' });
    }
    domainRouting.set(domain, { host, port });
    res.status(201).json({ message: 'Routing entry added/updated', domain, host, port });
});

app.post('/api/kick/username/:username', (req, res) => {
    const username = req.params.username;
    const connections = tcpProxy.findConnectionsByUsername(username);
    if (connections.length === 0) {
        return res.status(404).json({ error: 'No connections found with that username' });
    }
    connections.forEach(conn => conn.clientSocket.end());
    res.json({ message: `Kicked ${connections.length} connections with username ${username}` });
});

app.post('/api/kick/ip/:ip', (req, res) => {
    const ip = req.params.ip;
    const connections = tcpProxy.findConnectionsByIp(ip);
     if (connections.length === 0) {
        return res.status(404).json({ error: 'No connections found with that IP' });
    }
    connections.forEach(conn => conn.clientSocket.end());
    res.json({ message: `Kicked ${connections.length} connections with IP ${ip}` });
});

app.post('/api/kick/uuid/:uuid', (req, res) => {
    const uuid = req.params.uuid;
    const connections = tcpProxy.findConnectionsByUuid(uuid);
     if (connections.length === 0) {
        return res.status(404).json({ error: 'No connections found with that UUID' });
    }
    connections.forEach(conn => conn.clientSocket.end());
    res.json({ message: `Kicked ${connections.length} connections with UUID ${uuid}` });
});

// Delete a routing entry
app.delete('/api/routing/:domain', (req, res) => {
    const domain = req.params.domain;
    const success = domainRouting.remove(domain);
    if (success) {
        res.json({ message: 'Routing entry deleted', domain });
    } else {
        res.status(404).json({ error: 'Domain not found' });
    }
});

app.post('/api/kick/:connectionId', (req, res) => {
    const connectionId = req.params.connectionId;
    const connection = tcpProxy.activeConnections[connectionId];
    if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
    }
    connection.clientSocket.end('Kicked by server');
    res.json({ message: `Connection ${connectionId} kicked` });
});

// Start the API server
app.listen(PORT, () => {
    console.log(`Express API server listening on port ${PORT}`);
});
