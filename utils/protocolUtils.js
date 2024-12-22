// protocolUtils.js

/**
 * Parse data in VarInt format
 * @param {Buffer} buffer - Buffer to parse
 * @param {number} offset - Starting position for parsing
 * @returns {{ value: number, bytesRead: number }}
 */
function readVarInt(buffer, offset = 0) {
    let value = 0;
    let bytesRead = 0;

    while (true) {
        if (bytesRead >= 5) throw new Error("VarInt is too big");
        const byte = buffer[offset + bytesRead];
        if (byte === undefined) throw new Error("Buffer ended unexpectedly while reading VarInt");
        value |= (byte & 0x7F) << (7 * bytesRead);
        bytesRead++;
        if ((byte & 0x80) === 0) break;
    }

    return { value, bytesRead };
}

/**
 * Reads a Minecraft string from the buffer.
 * @param {Buffer} buffer - The buffer to read from.
 * @param {number} offset - The starting offset in the buffer.
 * @returns {{value: string, bytesRead: number}}
 */
function readMinecraftString(buffer, offset = 0) {
    const { value: length, bytesRead: lengthBytes } = readVarInt(buffer, offset);
    const start = offset + lengthBytes;
    const end = start + length;
    if (end > buffer.length) throw new Error("String length exceeds buffer size.");

    const value = buffer.toString('utf8', start, end);
    return { value, bytesRead: lengthBytes + length };
}

/**
 * Determine if the packet is a modern handshake or Ping packet
 * @param {Buffer} data - Data sent by the client
 * @returns {boolean}
 */
function isModernHandshakeOrPing(data) {
    if (!data || data.length < 1) {
        return false; // Invalid or empty packets are considered legacy
    }

    try {
        let offset = 0;

        // Parse packet length (VarInt)
        const { value: packetLength, bytesRead: lengthBytes } = readVarInt(data, offset);
        offset += lengthBytes;

        // Parse packet ID (VarInt)
        const { value: packetId, bytesRead: idBytes } = readVarInt(data, offset);
        offset += idBytes;

        // Determine packet type
        if (packetId === 0x00 || packetId === 0x01) {
            return true; // Modern handshake or modern Ping
        }

        return false; // Otherwise, consider it legacy
    } catch (err) {
        return false; // Errors are also considered legacy
    }
}

/**
 * Parse modern handshake packet (handled with VarInt structure)
 * @param {Buffer} data - Handshake data
 * @returns {string|null} - Extracted domain or null
 */
function parseModernHandshake(data) {
    let offset = 0;

    try {
        const { value: packetLength, bytesRead: lengthBytes } = readVarInt(data, offset);
        offset += lengthBytes;

        const { value: packetId, bytesRead: idBytes } = readVarInt(data, offset);
        if (packetId !== 0x00) throw new Error("Invalid handshake packet ID.");
        offset += idBytes;

        const { value: protocolVersion, bytesRead: versionBytes } = readVarInt(data, offset);
        offset += versionBytes;

        const { value: addressLength, bytesRead: addressLengthBytes } = readVarInt(data, offset);
        offset += addressLengthBytes;

        const domain = data.toString('utf8', offset, offset + addressLength);
        return sanitizeDomain(domain);
    } catch (err) {
        console.error('Error parsing modern handshake:', err.message);
        return null;
    }
}

/**
 * Clean and standardize domain names
 * @param {string} domain - Original domain name
 * @returns {string} - Cleaned domain name
 */
function sanitizeDomain(domain) {
    return domain
      // Remove all non-alphanumeric characters, dashes, and dots
      .replace(/[^a-zA-Z0-9-.]/g, '')
      // Detect and remove Forge/NeoForge suffixes (FML suffix)
      .replace(/FML\d*$/, '')
      // Remove whitespace from both ends
      .trim()
      // Remove trailing dots
      .replace(/\.+$/, '');
  }
  

/**
 * Get domain from modern handshake packet
 * @param {Buffer} data - Handshake data
 * @returns {{domain: string|null, dataWithoutHandshakePacket: Buffer}}
 */
function getModernMinecraftDomain(data) {
    try {
        let domain = null;
        let dataWithoutHandshakePacket = data;

        domain = parseModernHandshake(data);
        const { value: packetLength, bytesRead: lengthBytes } = readVarInt(data, 0);
        dataWithoutHandshakePacket = data.slice(lengthBytes + packetLength); // Slice off the handshake packet

        return { domain, dataWithoutHandshakePacket };
    } catch (err) {
        return { domain: null, dataWithoutHandshakePacket: null };
    }
}

/**
 * Get username from modern login packet.
 * @param {Buffer} data - Login data.
 * @returns {{username: string|null, dataWithoutLoginPacket: Buffer}}
 */
function getModernMinecraftUsername(data) {
    let offset = 0;

    try {
        // Parse the VarInt packet length
        const { value: packetLength, bytesRead: lengthBytes } = readVarInt(data, offset);
        offset += lengthBytes;

        // Parse the VarInt packet ID
        const { value: packetId, bytesRead: idBytes } = readVarInt(data, offset);
        if (packetId !== 0x00) {
            throw new Error("Invalid login packet ID.");
        }
        offset += idBytes;

        // Parse the username (string in the Minecraft packet protocol)
        const { value: username, bytesRead: usernameBytes } = readMinecraftString(data, offset);
        offset += usernameBytes;

        // Remaining data (excluding the parsed packet)
        const dataWithoutLoginPacket = data.slice(offset);

        return { username, dataWithoutLoginPacket };
    } catch (err) {
        console.error('Error parsing login packet:', err.message);
        return { username: null, dataWithoutLoginPacket: data };
    }
}

/**
 * Log the hexadecimal representation of data
 * @param {Buffer} data - Data to log
 * @param {Function: (message: string) => void} logger - Logger function
 */
function logHexData(data, logger) {
    logger("======Data (hex):======");
    let line = "";
    let i = 1;
    data.forEach((byte) => {
        line += byte.toString(16).padStart(2, '0') + " ";
        if (i % 16 === 0) {
            logger(line);
            line = "";
        }
        i++;
    });
    logger("=======================");
}

/**
 * @param {Buffer} data - The packet data.
 * Extracts the injected IP from the packet.
 * @returns {{ip: string, dataWithoutInjectedIp: Buffer}}
 */
function extractInjectedIP(data) {
    const markerLength = 4; // Marker "MCIP" length
    const marker = data.slice(0, markerLength).toString('utf8');

    if (marker !== "MCIP") {
        throw new Error("Invalid packet: Missing MCIP marker.");
    }

    const ipLength = data[markerLength]; // Extract IP length
    const totalInjectedLength = markerLength + 1 + ipLength; // Marker + length byte + IP bytes

    if (data.length < totalInjectedLength) {
        throw new Error("Packet length mismatch with injected data length.");
    }

    const ip = data.slice(markerLength + 1, totalInjectedLength).toString('utf8');

    console.log(`Detected injected IP: ${ip}`);
    data = data.slice(totalInjectedLength); // Remaining packet data

    return { ip, dataWithoutInjectedIp: data };
}

module.exports = {
    readVarInt,
    readMinecraftString,
    isModernHandshakeOrPing,
    parseModernHandshake,
    sanitizeDomain,
    getModernMinecraftDomain,
    getModernMinecraftUsername,
    extractInjectedIP,
    logHexData
};
