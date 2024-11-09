package dev.mcloudtw;

import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.*;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.handler.logging.LogLevel;
import io.netty.handler.logging.LoggingHandler;
import org.yaml.snakeyaml.Yaml;

import java.io.FileInputStream;
import java.io.FileReader;
import java.io.InputStream;
import java.nio.file.Paths;
import java.util.Map;

public class MinecraftProxy {
    private static int proxyPort;
    private static int apiPort;
    private static String apiKey;
    private static final EventLoopGroup clientGroup = new NioEventLoopGroup();

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

            ChannelFuture future = bootstrap.bind(proxyPort).sync();
            System.out.println("MinecraftProxy started，listen on port " + proxyPort);
            future.channel().closeFuture().sync();
        } finally {
            bossGroup.shutdownGracefully();
            workerGroup.shutdownGracefully();
        }
    }

    public static void main(String[] args) throws InterruptedException {
        loadConfig();
        RoutingApiServer.start(apiKey, apiPort);
        new MinecraftProxy().start();
    }

    private static void loadConfig() {
        Yaml yaml = new Yaml();
        try (InputStream in = new FileInputStream(Paths.get("config.yml").toFile())) {
            if (in == null) {
                throw new RuntimeException("config.yml not found");
            }
            Map<String, Object> config = yaml.load(in);
            apiKey = (String) config.get("apiKey");
            proxyPort = (int) config.get("proxyPort");
            apiPort = (int) config.get("apiPort");
        } catch (Exception e) {
            throw new RuntimeException("Failed to load config.yml", e);
        }
    }

    public static EventLoopGroup getClientGroup() {
        return clientGroup;
    }
}
