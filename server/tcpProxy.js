require('dotenv').config(); // Load environment variables

const net = require('net');
const utils = require('../utils/protocolUtils');
const domainRouting = require('../routes/domainRouting');

const LOCAL_PORT = process.env.TCP_PROXY_PORT || 25565;

let connectionId = 0;

function getNextConnectionId() {
    return connectionId++;
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
    let connectionId = getNextConnectionId();
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
        initialData = await waitForData(clientSocket);
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
        ({ domain, target, initialDataBuffer, username } = await handleInitialData(initialData, clientSocket, logger.log));
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
    logger.log('Connection injected IP: ' + ip);

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
    });
}

/**
 * Wait for the client to send data
 * @param {net.Socket} socket - Client socket connection
 * @returns {Promise<Buffer>}
 */
function waitForData(socket) {
    return new Promise((resolve, reject) => {
        const onData = (data) => {
            socket.removeListener('error', onError);
            resolve(data);
        };
        const onError = (err) => {
            socket.removeListener('data', onData);
            reject(err);
        };
        socket.once('data', onData);
        socket.once('error', onError);
    });
}

/**
 * Handle initial data to parse the domain and get the target server
 * @param {Buffer} data - Initial data sent by the client
 * @param {net.Socket} clientSocket - Client socket connection
 * @param {Function: (message: string) => void} logger - Logger function
 * @returns {Promise<{domain: string, target: object, initialDataBuffer: Buffer, username: string}>}
 */
async function handleInitialData(data, clientSocket, logger) {
    let {domain, dataWithoutHandshakePacket: dataNext} = utils.getModernMinecraftDomain(data);
    if (!domain) {
        throw new Error('Failed to parse domain from handshake');
    }
    // utils.logHexData(dataNext, logger);
    let {username, _} = utils.getModernMinecraftUsername(dataNext);

    const target = domainRouting.get(domain);
    if (!target) {
        throw new Error(`Unknown domain: ${domain}`);
    }

    return { domain, target, initialDataBuffer: data , username};
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
