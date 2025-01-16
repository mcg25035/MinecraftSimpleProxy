require('dotenv').config(); // Load environment variables

const net = require('net');
const utils = require('../utils/protocolUtils');
const domainRouting = require('../routes/domainRouting');
const axios = require('axios');
const mojangApiUtils = require('../utils/mojangApiUtils');

/**
 * @typedef {Object} Connection
 * @property {string} domain - The domain associated with the connection.
 * @property {string} ip - The IP address of the connected client.
 * @property {string} username - The username of the connected player.
 * @property {string} uuid - The UUID of the connected player.
 * @property {net.Socket} clientSocket - The socket representing the client's connection.
 * @property {number} remotePort
 */

/**
 * An object that keeps track of active connections.
 * @type {Object.<string, Connection>}
 */
const activeConnections = {};

const LOCAL_PORT = process.env.TCP_PROXY_PORT || 25565;
const MANAGER_ADDR = process.env.MANAGER_ADDR || '';
const MANAGER_API_KEY = process.env.MANAGER_API_KEY || '';

let connectionId = 0;

function getNextConnectionId() {
    return connectionId++;
}

async function sendConnectionInfoToManager(ip, domain, username, uuid) {
    if (!MANAGER_ADDR || !MANAGER_API_KEY) {
        console.warn('Manager address or API key is not set');
        return;
    }

    const url = `${MANAGER_ADDR}/api/connection-logs`;
    const data = {
        fullDomain: domain,
        playerName: username,
        playerIp: ip,
        playerUuid: uuid
    };

    try {
        await axios.post(url, data, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': MANAGER_API_KEY
            }
        });
        console.log('Connection info sent to manager');
    } catch (error) {
        console.error('Failed to send connection info to manager:', error);
    }
}

// Start the TCP Proxy server
const server = net.createServer(handleClientConnection);

server.listen(LOCAL_PORT, () => {
    console.log(`TCP Proxy server listening on port ${LOCAL_PORT}`);
});

/**
 * Handle new client connections
 * @param {net.Socket} clientSocket - Client socket connection
 */
async function handleClientConnection(clientSocket) {
    console.log('Client connected:', clientSocket.remoteAddress, clientSocket.remotePort);

    // State variables for the preprocessing phase
    let remoteSocket = null;
    let namePassed = false;
    let isModern = false;
    const connectionId = getNextConnectionId();
    let ip = "";

    const logger = {};
    logger.log = function (message) {
        console.log(`[Connection #${connectionId}] ${message}`);
    }

    logger.warn = function (message) {
        console.warn(`[Connection #${connectionId}] ${message}`);
    }

    // Wait for the client to send initial data
    let initialData;
    try {
        logger.log('Waiting for initial data...');
        initialData = await waitForData(clientSocket, logger.log);
        logger.log('Received initial data');
    }
    catch {
        logger.warn('Failed to receive initial data, closing connection');
        clientSocket.end("Failed to receive initial data");
        return;
    }

    logger.log('Extracting injected IP...');
    try {
        ({ ip, dataWithoutInjectedIp: initialData } = utils.extractInjectedIP(initialData));
    } catch (err) {
        logger.warn(err.message);
        clientSocket.end(err.message);
        return;
    }

    logger.log('Analyzing protocol...');

    isModern = utils.isModernHandshakeOrPing(initialData);
    isModern ? logger.log('Modern protocol') : logger.log('Legacy protocol');

    if (!isModern) {
        logger.warn('Legacy protocol detected, not supported yet, closing connection');
        clientSocket.end("Legacy protocol not supported");
        return;
    }

    let domain, target, initialDataBuffer, username;
    try {
        ({ domain, target, initialDataBuffer, username, uuid } = await handleInitialData(initialData, clientSocket, logger.log));
    }
    catch (err) {
        logger.warn(err.message);
        clientSocket.end(err.message);
        return;
    }

    logger.log('Connection target domain: ' + domain);
    logger.log('Connection player: ' + username);
    logger.log('Connection target host: ' + target.host);
    logger.log('Connection target port: ' + target.port);
    logger.log('Connection UUID: ' + uuid);
    logger.log('Connection injected IP: ' + ip);

    if (ip && domain && username) {
        sendConnectionInfoToManager(ip, domain, username, uuid);
    }

    const thirdLevelDomain = domain.split('.')[0];
    const firewallUrl = `${MANAGER_ADDR}/api/playerfirewall/domain/${thirdLevelDomain}`;

    try {
        logger.log('Fetching firewall rules...');
        const firewallResponse = await axios.get(firewallUrl, {
            headers: {
                'x-api-key': MANAGER_API_KEY
            }
        });

        const firewallRules = firewallResponse.data;
        logger.log('Firewall rules received: ' + JSON.stringify(firewallRules));

        const isBanned = firewallRules.some(rule => {
            if (rule.type === 'ipBan' && rule.value === ip) {
                return true;
            }
            if (rule.type === 'usernameBan' && rule.value === username) {
                return true;
            }
            if (rule.type === 'uuidBan' && rule.value === uuid) {
                return true;
            }
            return false;
        });

        if (isBanned) {
            logger.warn('Connection blocked by firewall');
            clientSocket.end('Connection blocked by firewall');
            return;
        }
    } catch (error) {
        logger.warn('Failed to fetch firewall rules:');
        console.log(error);
        // If the request fails, we don't block the connection
    }

    // Set up connection to the remote server
    try {
        logger.log('Trying to connect to remote server...');
        remoteSocket = await setupRemoteConnection(target, initialDataBuffer, clientSocket, namePassed, logger.log);
        logger.log('Connected to remote server');
    }
    catch (err) {
        logger.warn('Failed to connect to remote server:', err.message);
        clientSocket.end("Failed to connect to remote server");
        return;
    }

    activeConnections[connectionId] = {
        domain,
        ip,
        username,
        uuid,
        clientSocket,
        remotePort: target.port
    };

    logger.log('Connection established');
    // Set up data forwarding
    setupDataForwarding(clientSocket, remoteSocket, () => {
        namePassed = true;
    }, logger.log);

    // Handle client connection errors
    clientSocket.on('error', (err) => {
        logger.warn('Client socket error:', err.message);
        if (remoteSocket) remoteSocket.end();
        logger.log('Connection closed');
        delete activeConnections[connectionId];
    });
}

function findConnectionsByUsername(username, targetPort) {
    return Object.values(activeConnections).filter((conn) => {
        return conn.username === username && conn.remotePort === Number(targetPort)
    });
}

function findConnectionsByIp(ip, targetPort) {
    return Object.values(activeConnections).filter((conn) => {
        return conn.ip === ip && conn.remotePort === Number(targetPort)
    });
}

function findConnectionsByUuid(uuid, targetPort) {
    return Object.values(activeConnections).filter((conn) => {
        return conn.uuid === uuid && conn.remotePort === Number(targetPort)
    });
}

/**
 * Wait for the client to send data, collecting data until no new data is received for 250ms
 * @param {net.Socket} socket - Client socket connection
 * @param {Function: (message: string) => void} logger - Logger function
 * @returns {Promise<Buffer>}
 */
function waitForData(socket, logger) {
    return new Promise((resolve, reject) => {
        let collectedData = Buffer.alloc(0);
        let timeout;
        let dataReceivedCounter = 0;

        const onData = (data) => {
            logger(`#${++dataReceivedCounter} Received initial data (${data.length} bytes)`);
            collectedData = Buffer.concat([collectedData, data]);
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                cleanup();
                resolve(collectedData);
            }, 250);
        };

        const onError = (err) => {
            cleanup();
            reject(err);
        };

        const cleanup = () => {
            socket.removeListener('data', onData);
            socket.removeListener('error', onError);
            clearTimeout(timeout);
        };

        socket.on('data', onData);
        socket.once('error', onError);

        // Set initial timeout in case no data is received
        timeout = setTimeout(() => {
            cleanup();
            resolve(collectedData);
        }, 5);
    });
}

/**
 * Handle initial data to parse the domain and get the target server
 * @param {Buffer} data - Initial data sent by the client
 * @param {net.Socket} clientSocket - Client socket connection
 * @param {Function: (message: string) => void} logger - Logger function
 * @returns {Promise<{domain: string, target: object, initialDataBuffer: Buffer, username: string, uuid: string}>}
 */
async function handleInitialData(data, clientSocket, logger) {
    let { domain, dataWithoutHandshakePacket: dataNext } = utils.getModernMinecraftDomain(data);
    if (!domain) {
        throw new Error('Failed to parse domain from handshake');
    }
    // utils.logHexData(dataNext, logger);
    let { username, _ } = utils.getModernMinecraftUsername(dataNext);
    let uuid = await mojangApiUtils.getPlayerUUID(username);

    const target = domainRouting.get(domain);
    if (!target) {
        throw new Error(`Unknown domain: ${domain}`);
    }

    return { domain, target, initialDataBuffer: data, username, uuid };
}

/**
 * Set up connection to the remote server and send initial data
 * @param {object} target - Target server's host and port
 * @param {Buffer} initialData - Client's initial data
 * @param {net.Socket} clientSocket - Client socket connection
 * @param {boolean} namePassed - Whether the player name has passed validation
 * @param {Function: (message: string) => void} logger - Logger function
 * @returns {Promise<net.Socket>}
 */
function setupRemoteConnection(target, initialData, clientSocket, namePassed, logger) {
    return new Promise((resolve, reject) => {
        const remoteSocket = net.createConnection({
            host: target.host,
            port: target.port
        }, () => {
            remoteSocket.write(initialData);

            if (!namePassed) {
                namePassed = initialData.toString().includes('codingbear');
                utils.logHexData(initialData, logger);
            }

            resolve(remoteSocket);
        });

        // Handle errors in the remote connection
        remoteSocket.on('error', (err) => {
            clientSocket.end();
            reject(err);
        });
    });
}

/**
 * Set up data forwarding from the client to the remote server and vice versa
 * @param {net.Socket} clientSocket - Client socket connection
 * @param {net.Socket} remoteSocket - Remote server's socket connection
 * @param {Function} onNamePassed - Callback function when the name passes validation
 * @param {Function: (message: string) => void} logger - Logger function
 */
function setupDataForwarding(clientSocket, remoteSocket, onNamePassed, logger) {
    // Forward data from client to remote server
    clientSocket.on('data', (data) => {
        remoteSocket.write(data);
        if (!onNamePassed.called && data.toString().includes('codingbear')) {
            onNamePassed();
            utils.logHexData(data, logger);
        }
    });

    // Forward data from remote server to client
    remoteSocket.on('data', (data) => {
        clientSocket.write(data);
    });

    // Close remote connection when the client disconnects
    clientSocket.on('end', () => {
        remoteSocket.end();
    });

    // Close client connection when the remote server disconnects
    remoteSocket.on('end', () => {
        clientSocket.end();
    });

    // Handle errors in the client connection
    clientSocket.on('error', (err) => {
        console.error('Client socket error:', err.message);
        remoteSocket.end();
    });

    // Handle errors in the remote connection
    remoteSocket.on('error', (err) => {
        console.error('Remote socket error:', err.message);
        clientSocket.end();
    });
}


module.exports = {
    findConnectionsByIp,
    findConnectionsByUsername,
    findConnectionsByUuid
}