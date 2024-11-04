package dev.mcloudtw;

import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.*;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.handler.logging.LogLevel;
import io.netty.handler.logging.LoggingHandler;

public class MinecraftProxy {
    private final int localPort;
    private static final EventLoopGroup clientGroup = new NioEventLoopGroup();

    public MinecraftProxy(int localPort) {
        this.localPort = localPort;
    }

    public void start() throws InterruptedException {
        EventLoopGroup bossGroup = new NioEventLoopGroup(1);
        EventLoopGroup workerGroup = new NioEventLoopGroup();

        try {
            ServerBootstrap bootstrap = new ServerBootstrap();
            bootstrap.group(bossGroup, workerGroup)
                    .channel(NioServerSocketChannel.class)
                    .handler(new LoggingHandler(LogLevel.INFO))
                    .childHandler(new ChannelInitializer<Channel>() {
                        @Override
                        protected void initChannel(Channel ch) throws Exception {
                            ch.pipeline().addLast(new ProxyFrontendHandler());
                        }
                    })
                    .option(ChannelOption.SO_BACKLOG, 128)
                    .childOption(ChannelOption.AUTO_READ, false);

            ChannelFuture future = bootstrap.bind(localPort).sync();
            System.out.println("MinecraftProxy started，listen on port " + localPort);
            future.channel().closeFuture().sync();
        } finally {
            bossGroup.shutdownGracefully();
            workerGroup.shutdownGracefully();
        }
    }

    public static void main(String[] args) throws InterruptedException {
        int localPort = 25599;
        new MinecraftProxy(localPort).start();
    }

    public static EventLoopGroup getClientGroup() {
        return clientGroup;
    }
}
