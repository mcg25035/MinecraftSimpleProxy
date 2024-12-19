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

function removeInjectedIP(packet) {
    const markerLength = 4; // 固定標記長度
    const marker = packet.slice(0, markerLength).toString('utf8'); // 提取標記

    if (marker !== "MCIP") {
        throw new Error("Invalid packet: Missing MCIP marker.");
    }

    const ipLength = packet[markerLength]; // 提取 IP 長度
    const totalInjectedLength = markerLength + 1 + ipLength; // 標記 + 長度字節 + IP 字節

    if (packet.length < totalInjectedLength) {
        throw new Error("Packet length mismatch with injected data length.");
    }

    // 返回移除注入部分的封包
    return packet.slice(totalInjectedLength); // 移除標記、長度和 IP
}


// Function to extract the Minecraft domain from the initial data
function getMinecraftDomain(data) {
    try {
        // 檢查數據包的第一個字節，判斷是舊版還是新版
        const firstByte = data[0];
        if (firstByte === 0xFE) {
            console.log("Detected legacy (pre-1.7) handshake packet.");
            return parseLegacyHandshake(data);
        } else {
            console.log("Detected modern (1.7+) handshake packet.");
            return parseModernHandshake(data);
        }
    } catch (err) {
        console.error('Error parsing Minecraft handshake:', err.message);
        return null;
    }
}

// 舊版握手包解析邏輯 (以 0xFE 開頭)
function parseLegacyHandshake(data) {
    try {
        // 使用 removeInjectedIP 移除注入部分
        const cleanedData = removeInjectedIP(data);

        const domainEnd = cleanedData.indexOf(0x00); // 舊版結構以 0x00 結尾
        if (domainEnd === -1) throw new Error('Invalid legacy handshake packet.');

        const domain = cleanedData.toString('utf8', 0, domainEnd); // 提取域名
        return domain;
    } catch (err) {
        console.error('Error parsing legacy handshake:', err.message);
        return null;
    }
}



// 現代協議握手包解析邏輯 (以 VarInt 結構處理)
function parseModernHandshake(data) {
    let offset = 0;

    try {
        // 使用 removeInjectedIP 移除注入部分
        const cleanedData = removeInjectedIP(data);
        console.log('Cleaned Data (Hex):', cleanedData.toString('hex'));

        // Parse cleaned packet
        const { value: packetLength, bytesRead: lengthBytes } = readVarInt(cleanedData, offset);
        offset += lengthBytes;

        const { value: packetId, bytesRead: idBytes } = readVarInt(cleanedData, offset);
        if (packetId !== 0x00) throw new Error("Invalid handshake packet ID.");
        offset += idBytes;

        const { value: protocolVersion, bytesRead: versionBytes } = readVarInt(cleanedData, offset);
        offset += versionBytes;

        const addressLength = cleanedData[offset];
        offset += 1;

        const domain = cleanedData.toString('utf8', offset, offset + addressLength);
        return sanitizeDomain(domain);
    } catch (err) {
        console.error('Error parsing modern handshake:', err.message);
        return null;
    }
}


function sanitizeDomain(domain) {
    // 移除所有非字母、数字、破折号和点号的字符
    domain = domain.replace(/[^a-zA-Z0-9-.]/g, "");

    // 检测并移除 Forge/NeoForge 的后缀 (FML 后缀)
    domain = domain.replace(/FML[0-9]*$/, "");

    // 移除多余的空格
    domain = domain.trim();

    // 移除结尾的点号
    while (domain.endsWith('.')) {
        domain = domain.slice(0, -1);
    }

    return domain;
}


// VarInt 解析函數
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
