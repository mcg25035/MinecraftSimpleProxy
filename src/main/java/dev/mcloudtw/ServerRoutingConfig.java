package dev.mcloudtw;

import java.util.HashMap;
import java.util.Map;

/**
 * Server routing configuration class.
 */
public class ServerRoutingConfig {

    // Mapping from domain name to target server
    private static final Map<String, ServerInfo> routingMap = new HashMap<>();

    static {
        // Example mappings
        routingMap.put("ptero.tw1.mcloudtw.com", new ServerInfo("127.0.0.1", 25568));
        routingMap.put("tw1.mcloudtw.com", new ServerInfo("127.0.0.1", 25565));
        // Add more mappings as needed
    }

    /**
     * Get target server information based on the domain name.
     *
     * @param domain Domain name
     * @return Target server information, or null if not found
     */
    public static ServerInfo getServerInfo(String domain) {
        return routingMap.get(domain.toLowerCase());
    }

    /**
     * Server information class.
     */
    public static class ServerInfo {
        private final String host;
        private final int port;

        public ServerInfo(String host, int port) {
            this.host = host;
            this.port = port;
        }

        public String getHost() {
            return host;
        }

        public int getPort() {
            return port;
        }
    }
}