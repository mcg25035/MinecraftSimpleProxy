package dev.mcloudtw;

import io.netty.bootstrap.Bootstrap;
import io.netty.buffer.ByteBuf;
import io.netty.channel.*;
import io.netty.channel.socket.nio.NioSocketChannel;
import io.netty.util.ReferenceCountUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.nio.charset.StandardCharsets;

public class ProxyFrontendHandler extends ChannelInboundHandlerAdapter {
    private static final Logger logger = LoggerFactory.getLogger(ProxyFrontendHandler.class);
    private String remoteHost;
    private int remotePort;
    private volatile Channel outboundChannel;
    private final Bootstrap bootstrap = new Bootstrap();
    private final HandshakeHandler handshakeHandler = new HandshakeHandler();

    public ProxyFrontendHandler() {
        // 初始化可以留空，因為遠端伺服器將根據握手動態決定
    }

    @Override
    public void channelActive(ChannelHandlerContext ctx) {
        final Channel inboundChannel = ctx.channel();

        // 使用獨立的 EventLoopGroup 來處理外發連接
        bootstrap.group(MinecraftProxy.getClientGroup())
                .channel(NioSocketChannel.class)
                .option(ChannelOption.AUTO_READ, true)
                .handler(new ProxyBackendHandler(inboundChannel));

        // 開始讀取數據
        ctx.read();
    }

    private void connectToRemoteServerWithInitMsg(ChannelHandlerContext ctx, Object msg) {
        final Channel inboundChannel = ctx.channel();

        ChannelFuture future = bootstrap.connect(remoteHost, remotePort);
        outboundChannel = future.channel();
        future.addListener((ChannelFutureListener) f -> {
            if (!f.isSuccess()) {
                logger.error("Unable to connect to remote server {}:{}", remoteHost, remotePort);
                ChannelUtils.closeOnFlush(inboundChannel);
                return;
            }
            logger.info("Successfully connected to remote server {}:{}", remoteHost, remotePort);
            logger.debug("a");
            forwardToOutbound(ctx, msg);
            logger.debug("b");
            inboundChannel.read();
            logger.debug("c");
        });
    }

    private void forwardToOutbound(ChannelHandlerContext ctx, Object msg) {
        if (outboundChannel == null || !outboundChannel.isActive()) {
            logger.warn("Outbound channel is not active. Dropping message.");
            ReferenceCountUtil.release(msg);
            return;
        }

        // 保持引用
        ReferenceCountUtil.retain(msg);

        outboundChannel.writeAndFlush(msg).addListener((ChannelFutureListener) future -> {
            if (!future.isSuccess()) {
                future.channel().close();
            }
            // 繼續讀取客戶端數據
            ctx.channel().read();
        });
    }

    @Override
    public void channelRead(final ChannelHandlerContext ctx, Object msg) {
        if (handshakeHandler.isHandshakeProcessed()) {
            forwardToOutbound(ctx, msg);
            return;
        }

        if (!(msg instanceof ByteBuf)) {
            ChannelUtils.closeOnFlush(ctx.channel());
            return;
        }
        ByteBuf buf = (ByteBuf) msg;

        try {
            HandshakeHandler.HandshakeResult result = handshakeHandler.processHandshake(buf);
            if (result == null) return;

            if (!result.isHandshake()) {
                ChannelUtils.closeOnFlush(ctx.channel());
                return;
            }

            logger.info("Handshake completed - Protocol Version: {}, Server Address: {}, Port: {}, Next State: {}",
                    result.getProtocolVersion(),
                    result.getServerAddress(),
                    result.getServerPort(),
                    result.getNextState());

            ServerRoutingConfig.ServerInfo targetServer = ServerRoutingConfig.getServerInfo(result.getServerAddress());

            if (targetServer == null) {
                logger.error("Server address not found in configuration: {}", result.getServerAddress());
                ChannelUtils.closeOnFlush(ctx.channel());
                return;
            }

            remoteHost = targetServer.getHost();
            remotePort = targetServer.getPort();

            connectToRemoteServerWithInitMsg(ctx, buf);
        } catch (IndexOutOfBoundsException e) {
            logger.debug("e");
            buf.resetReaderIndex();
            logger.debug("f");
        } catch (Exception e) {
            logger.error("Exception occurred while parsing handshake packet: ", e);
            ChannelUtils.closeOnFlush(ctx.channel());
        }
        logger.debug("g");
    }

    @Override
    public void channelInactive(ChannelHandlerContext ctx) {
        if (outboundChannel != null) {
            ChannelUtils.closeOnFlush(outboundChannel);
        }
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        logger.error("ProxyFrontendHandler encountered an exception: ", cause);
        ChannelUtils.closeOnFlush(ctx.channel());
    }

    /**
     * Convert byte array to hexadecimal string
     *
     * @param bytes byte array
     * @return hexadecimal string
     */
    private String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02X ", b));
        }
        return sb.toString().trim();
    }

    /**
     * Forward message to remote server
     */
    private void forwardMessage(ChannelHandlerContext ctx, Object msg) {
        if (!outboundChannel.isActive()) {
            return;
        }

        outboundChannel.writeAndFlush(msg).addListener((ChannelFutureListener) future -> {
            if (!future.isSuccess()) {
                outboundChannel.close();
                return;
            }
            ctx.channel().read();
        });
    }

    /**
     * Read VarInt
     */
    private int readVarInt(ByteBuf buf) {
        int numRead = 0;
        int result = 0;
        byte read;
        do {
            read = buf.readByte();
            int value = (read & 0b01111111);
            result |= (value << (7 * numRead));

            numRead++;
            if (numRead > 5) {
                throw new RuntimeException("VarInt too long");
            }
        } while ((read & 0b10000000) != 0);

        return result;
    }

    /**
     * Read String
     */
    private String readString(ByteBuf buf) {
        int length = readVarInt(buf);
        byte[] bytes = new byte[length];
        buf.readBytes(bytes);
        return new String(bytes, StandardCharsets.UTF_8);
    }
}
