package dev.mcloudtw;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.lang.reflect.Type;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class ServerRoutingConfig {

    private static final Logger logger = LoggerFactory.getLogger(ServerRoutingConfig.class);

    private static final String ROUTING_FILE_PATH = "routingMap.json"; // Path to the routing file
    private static final Gson gson = new GsonBuilder().setPrettyPrinting().create();
    private static final Type ROUTING_MAP_TYPE = new TypeToken<ConcurrentHashMap<String, ServerInfo>>() {}.getType();

    private static final Map<String, ServerInfo> routingMap = new ConcurrentHashMap<>();

    // Static block, executed when the class is loaded, loads routes from the file
    static {
        loadRoutingMap();
    }

    /**
     * Load routes from the JSON file
     */
    private static void loadRoutingMap() {
        File file = new File(ROUTING_FILE_PATH);
        if (file.exists()) {
            try (FileReader reader = new FileReader(file)) {
                Map<String, ServerInfo> loadedMap = gson.fromJson(reader, ROUTING_MAP_TYPE);
                if (loadedMap != null) {
                    routingMap.putAll(loadedMap);
                    logger.info("Routing map loaded successfully from {}", ROUTING_FILE_PATH);
                } else {
                    logger.info("Routing map file is empty. Initializing with an empty map.");
                }
            } catch (IOException e) {
                logger.error("Failed to load routing map from file: {}", e.getMessage());
            }
        } else {
            logger.info("Routing map file not found. Initializing with default routes.");
            saveRoutingMap(); // Save default routes to the file
        }
    }

    /**
     * Save the current routes to the JSON file
     */
    private static void saveRoutingMap() {
        try (FileWriter writer = new FileWriter(ROUTING_FILE_PATH)) {
            gson.toJson(routingMap, writer);
            logger.info("Routing map saved successfully to {}", ROUTING_FILE_PATH);
        } catch (IOException e) {
            logger.error("Failed to save routing map to file: {}", e.getMessage());
        }
    }

    public static ServerInfo getServerInfo(String domain) {
        return routingMap.get(domain.toLowerCase());
    }

    public static Map<String, ServerInfo> getAllRoutes() {
        return Collections.unmodifiableMap(routingMap);
    }

    public static synchronized boolean addRoute(String domain, ServerInfo serverInfo) {
        if (routingMap.putIfAbsent(domain.toLowerCase(), serverInfo) == null) {
            saveRoutingMap();
            return true;
        }
        return false;
    }

    public static synchronized boolean updateRoute(String domain, ServerInfo serverInfo) {
        if (routingMap.replace(domain.toLowerCase(), serverInfo) != null) {
            saveRoutingMap();
            return true;
        }
        return false;
    }

    public static synchronized boolean deleteRoute(String domain) {
        if (routingMap.remove(domain.toLowerCase()) != null) {
            saveRoutingMap();
            return true;
        }
        return false;
    }

    public record ServerInfo(String host, int port) {
    }
}
