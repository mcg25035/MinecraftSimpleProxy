package dev.mcloudtw;

import io.netty.buffer.ByteBuf;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class HandshakeHandler {
    private static final Logger logger = LoggerFactory.getLogger(HandshakeHandler.class);
    private boolean handshakeProcessed = false;

    public HandshakeResult processHandshake(ByteBuf buf) throws Exception {
        buf.markReaderIndex();

        int packetLength = readVarInt(buf);
        if (buf.readableBytes() < packetLength) {
            buf.resetReaderIndex();
            return null;
        }

        int packetId = readVarInt(buf);
        if (packetId != 0x00) {
            logger.warn("Received non-handshake packet, Packet ID: {}", packetId);
            buf.resetReaderIndex();
            return HandshakeResult.notHandshake(packetId);
        }

        int protocolVersion = readVarInt(buf);
        String serverAddress = readString(buf);
        int serverPort = buf.readUnsignedShort();
        int nextState = readVarInt(buf);

        logger.info("Player connection request - Server address: {}, Port: {}", serverAddress, serverPort);
        handshakeProcessed = true;
        buf.resetReaderIndex();
        return HandshakeResult.handshake(protocolVersion, serverAddress, serverPort, nextState);
    }

    public boolean isHandshakeProcessed() {
        return handshakeProcessed;
    }

    private int readVarInt(ByteBuf buf) throws Exception {
        int numRead = 0;
        int result = 0;
        byte read;
        do {
            if (!buf.isReadable()) {
                throw new IndexOutOfBoundsException("Unable to read VarInt, insufficient data");
            }
            read = buf.readByte();
            int value = (read & 0b01111111);
            result |= (value << (7 * numRead));

            numRead++;
            if (numRead > 5) {
                throw new Exception("VarInt is too long");
            }
        } while ((read & 0b10000000) != 0);

        return result;
    }

    private String readString(ByteBuf buf) throws Exception {
        int length = readVarInt(buf);
        if (buf.readableBytes() < length) {
            throw new IndexOutOfBoundsException("Unable to read complete string, insufficient data");
        }
        byte[] bytes = new byte[length];
        buf.readBytes(bytes);
        return new String(bytes, "UTF-8");
    }

    public static class HandshakeResult {
        private final boolean isHandshake;
        private final int packetId;
        private final int protocolVersion;
        private final String serverAddress;
        private final int serverPort;
        private final int nextState;

        private HandshakeResult(boolean isHandshake, int packetId, int protocolVersion, String serverAddress, int serverPort, int nextState) {
            this.isHandshake = isHandshake;
            this.packetId = packetId;
            this.protocolVersion = protocolVersion;
            this.serverAddress = serverAddress;
            this.serverPort = serverPort;
            this.nextState = nextState;
        }

        public static HandshakeResult handshake(int protocolVersion, String serverAddress, int serverPort, int nextState) {
            return new HandshakeResult(true, 0x00, protocolVersion, serverAddress, serverPort, nextState);
        }

        public static HandshakeResult notHandshake(int packetId) {
            return new HandshakeResult(false, packetId, 0, null, 0, 0);
        }

        public boolean isHandshake() {
            return isHandshake;
        }

        public int getPacketId() {
            return packetId;
        }

        public int getProtocolVersion() {
            return protocolVersion;
        }

        public String getServerAddress() {
            return serverAddress;
        }

        public int getServerPort() {
            return serverPort;
        }

        public int getNextState() {
            return nextState;
        }
    }
}