require('dotenv').config(); // Load environment variables

const net = require('net');
const domainRouting = require('../routes/domainRouting');

const LOCAL_PORT = process.env.TCP_PROXY_PORT || 25565;
/**
 * Extract injected IP and data from the packet.
 * @param {Buffer} packet - The packet with injected IP and marker.
 * @returns {{ ip: string, data: Buffer }} Extracted IP and the remaining packet.
 * @throws Will throw an error if the packet is invalid or malformed.
 */
function extractInjectedIP(packet) {
    const markerLength = 4; // Marker "MCIP" length
    const marker = packet.slice(0, markerLength).toString('utf8');

    if (marker !== "MCIP") {
        throw new Error("Invalid packet: Missing MCIP marker.");
    }

    const ipLength = packet[markerLength]; // Extract IP length
    const totalInjectedLength = markerLength + 1 + ipLength; // Marker + length byte + IP bytes

    if (packet.length < totalInjectedLength) {
        throw new Error("Packet length mismatch with injected data length.");
    }

    const ip = packet.slice(markerLength + 1, totalInjectedLength).toString('utf8');
    const data = packet.slice(totalInjectedLength); // Remaining packet data

    return { ip, data };
}

function handleLoginPhase(data, ip, isLegacy) {
    try {
        if (isLegacy) {
            const nameLength = data.readUInt16BE(0); // UTF-16 length
            const username = data.toString('utf16le', 2, 2 + nameLength);
            console.log(`IP: ${ip}, Legacy Username: ${username}`);
        } else {
            let offset = 0;
            const { value: packetLength, bytesRead: lengthBytes } = readVarInt(data, offset);
            offset += lengthBytes;

            const { value: packetId, bytesRead: idBytes } = readVarInt(data, offset);
            if (packetId !== 0x00) throw new Error("Not a Login Start packet.");
            offset += idBytes;

            const { value: nameLength, bytesRead: nameLengthBytes } = readVarInt(data, offset);
            offset += nameLengthBytes;

            const username = data.toString('utf8', offset, offset + nameLength);
            console.log(`IP: ${ip}, Modern Username: ${username}`);
        }
    } catch (err) {
        console.error(`Error handling login phase: ${err.message}`);
    }
}

const server = net.createServer((clientSocket) => {
    console.log('Client connected:', clientSocket.remoteAddress, clientSocket.remotePort);

    let initialDataBuffer = null;
    let remoteSocket = null;
    let loginProcessed = false; // Ensure login is only processed once

    clientSocket.once('data', (data) => {
        try {
            const { ip, data: cleanedData } = extractInjectedIP(data);
            const domain = getMinecraftDomain(cleanedData);
            console.log('Host:', domain);

            const target = domainRouting.get(domain);

            if (!target) {
                clientSocket.end("Unknown domain");
                console.warn(`Unknown domain: ${domain}`);
                return;
            }

            initialDataBuffer = cleanedData;

            remoteSocket = net.createConnection({
                host: target.host,
                port: target.port
            }, () => {
                console.log(`Connected to remote server: ${target.host}:${target.port}`);

                remoteSocket.write(initialDataBuffer);

                clientSocket.on('data', (data) => {
                    if (!loginProcessed) {
                        try {
                            const { data: postExtractData } = extractInjectedIP(data);
                            const isLegacy = data[0] === 0xFE;
                            handleLoginPhase(postExtractData, ip, isLegacy);
                            loginProcessed = true;
                        } catch (e) {
                            console.error(`Login processing error: ${e.message}`);
                        }
                    }
                    remoteSocket.write(data);
                });
            });

            remoteSocket.on('data', (data) => {
                clientSocket.write(data);
            });

            clientSocket.on('end', () => {
                remoteSocket.end();
            });

            remoteSocket.on('end', () => {
                clientSocket.end();
            });

            clientSocket.on('error', (err) => {
                console.error('Client socket error:', err.message);
                remoteSocket.end();
            });

            remoteSocket.on('error', (err) => {
                console.error('Remote socket error:', err.message);
                clientSocket.end();
            });
        } catch (err) {
            console.error(`Error during handshake processing: ${err.message}`);
            clientSocket.end();
        }
    });
});

server.listen(LOCAL_PORT, () => {
    console.log(`TCP Proxy server listening on port ${LOCAL_PORT}`);
});

