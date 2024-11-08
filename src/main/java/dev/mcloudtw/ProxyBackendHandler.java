package dev.mcloudtw;

import io.netty.buffer.ByteBuf;
import io.netty.channel.*;
import io.netty.util.ReferenceCountUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ProxyBackendHandler extends ChannelInboundHandlerAdapter {
    private static final Logger logger = LoggerFactory.getLogger(ProxyBackendHandler.class);
    private final Channel inboundChannel;

    public ProxyBackendHandler(Channel inboundChannel) {
        this.inboundChannel = inboundChannel;
    }

    @Override
    public void channelActive(ChannelHandlerContext ctx) {
        ctx.read();
        ctx.flush();
    }

    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) {
        if (!inboundChannel.isActive()) {
            ReferenceCountUtil.release(msg);
            return;
        }

        ReferenceCountUtil.retain(msg);
        inboundChannel.writeAndFlush(msg).addListener((ChannelFutureListener) future -> {
            if (!future.isSuccess()) return;
            future.channel().close();
        });
    }

    @Override
    public void channelInactive(ChannelHandlerContext ctx) {
        ChannelUtils.closeOnFlush(inboundChannel);
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        logger.error("ProxyBackendHandler encountered an exception: ", cause);
        ChannelUtils.closeOnFlush(ctx.channel());
    }
}
