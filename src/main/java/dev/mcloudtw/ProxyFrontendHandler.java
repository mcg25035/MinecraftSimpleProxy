package dev.mcloudtw;

import io.netty.bootstrap.Bootstrap;
import io.netty.buffer.ByteBuf;
import io.netty.channel.*;
import io.netty.channel.socket.nio.NioSocketChannel;
import io.netty.util.ReferenceCountUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ProxyFrontendHandler extends ChannelInboundHandlerAdapter {
    private static final Logger logger = LoggerFactory.getLogger(ProxyFrontendHandler.class);
    private String remoteHost;
    private int remotePort;
    private volatile Channel outboundChannel;
    private final Bootstrap bootstrap = new Bootstrap();
    private final HandshakeHandler handshakeHandler = new HandshakeHandler();

    public ProxyFrontendHandler() {
    }

    @Override
    public void channelActive(ChannelHandlerContext ctx) {
        final Channel inboundChannel = ctx.channel();

        bootstrap.group(MinecraftProxy.getClientGroup())
                .channel(NioSocketChannel.class)
                .option(ChannelOption.AUTO_READ, true)
                .handler(new ProxyBackendHandler(inboundChannel));

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
            forwardToOutbound(ctx, msg);
            inboundChannel.read();
        });
    }

    private void forwardToOutbound(ChannelHandlerContext ctx, Object msg) {
        if (outboundChannel == null || !outboundChannel.isActive()) {
            logger.warn("Outbound channel is not active. Dropping message.");
            ReferenceCountUtil.release(msg);
            return;
        }

        ReferenceCountUtil.retain(msg);

        outboundChannel.writeAndFlush(msg).addListener((ChannelFutureListener) future -> {
            if (!future.isSuccess()) {
                future.channel().close();
                return;
            }

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

            remoteHost = targetServer.host();
            remotePort = targetServer.port();

            connectToRemoteServerWithInitMsg(ctx, buf);
        } catch (IndexOutOfBoundsException e) {
            buf.resetReaderIndex();
        } catch (Exception e) {
            logger.error("Exception occurred while parsing handshake packet: ", e);
            ChannelUtils.closeOnFlush(ctx.channel());
        }
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
}
