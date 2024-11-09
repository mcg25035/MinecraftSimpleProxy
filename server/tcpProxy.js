require('dotenv').config(); // Load environment variables

const net = require('net');
const domainRouting = require('../routes/domainRouting');

const LOCAL_PORT = process.env.TCP_PROXY_PORT || 25565;

const server = net.createServer((clientSocket) => {
    console.log('Client connected:', clientSocket.remoteAddress, clientSocket.remotePort);

    let initialDataBuffer = null;
    let remoteSocket = null;

    clientSocket.once('data', (data) => {
        const domain = getMinecraftDomain(data);
        console.log('Host:', domain);

        const target = domainRouting.get(domain);

        if (!target) {
            clientSocket.end("Unknown domain");
            console.warn(`Unknown domain: ${domain}`);
            return;
        }

        console.log('Initial data from client:', data.toString());

        initialDataBuffer = data;

        remoteSocket = net.createConnection({
            host: target.host,
            port: target.port
        }, () => {
            console.log(`Connected to remote server: ${target.host}:${target.port}`);

            remoteSocket.write(initialDataBuffer);

            clientSocket.on('data', (data) => {
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
    });
});

server.listen(LOCAL_PORT, () => {
    console.log(`TCP Proxy server listening on port ${LOCAL_PORT}`);
});

// Function to extract the Minecraft domain from the initial data
function getMinecraftDomain(data) {
    let offset = 0;

    try {
        const { value: packetLength, bytesRead: lengthBytes } = readVarInt(data, offset);
        offset += lengthBytes;

        const { value: packetId, bytesRead: idBytes } = readVarInt(data, offset);
        if (packetId !== 0x00) return null;
        offset += idBytes;

        const { value: protocolVersion, bytesRead: versionBytes } = readVarInt(data, offset);
        offset += versionBytes;

        const addressLength = data[offset];
        offset += 1;

        const domain = data.toString('utf8', offset, offset + addressLength);
        return domain;
    } catch (err) {
        console.error('Error parsing Minecraft domain:', err.message);
        return null;
    }
}

// Function to read a VarInt from a buffer
function readVarInt(buffer, offset = 0) {
    let value = 0;
    let bytesRead = 0;

    while (true) {
        if (bytesRead >= 5) throw new Error("VarInt is too big");
        const byte = buffer[offset + bytesRead];
        value |= (byte & 0x7F) << (7 * bytesRead);
        bytesRead++;
        if ((byte & 0x80) === 0) break;
    }

    return { value, bytesRead };
}
