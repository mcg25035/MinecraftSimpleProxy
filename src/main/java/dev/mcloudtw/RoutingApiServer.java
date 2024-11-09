package dev.mcloudtw;

import io.javalin.Javalin;
import io.javalin.http.Context;
import io.javalin.http.Handler;
import io.javalin.http.UnauthorizedResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;

public class RoutingApiServer {

    private static final Logger logger = LoggerFactory.getLogger(RoutingApiServer.class);
    private static String CONFIG_API_KEY;

    public static void start(String configApiKey, int port) {
        CONFIG_API_KEY = configApiKey;

        if (CONFIG_API_KEY == null || CONFIG_API_KEY.isEmpty()) {
            logger.error("Error: API key is not set in the configuration");
            System.exit(1);
        }

        Javalin app = Javalin.create(config -> {
        }).start(port);

        // API Key authentication middleware
        app.before(RoutingApiServer::validateApiKey);

        // Define routes
        app.get("/routes", getAllRoutesHandler);
        app.post("/routes", createRouteHandler);
        app.get("/routes/{domain}", getRouteHandler);
        app.put("/routes/{domain}", updateRouteHandler);
        app.delete("/routes/{domain}", deleteRouteHandler);

        // Global exception handler (optional)
        app.exception(Exception.class, (e, ctx) -> {
            ctx.status(500).json(Map.of("error", "Internal Server Error"));
        });

        logger.info("Routing API server started on port 7000");
    }

    // Middleware: Validate API Key
    private static void validateApiKey(Context ctx) throws UnauthorizedResponse {
        String API_KEY_HEADER = "x-api-key";
        String apiKey = ctx.header(API_KEY_HEADER);
        if (apiKey == null || !apiKey.equals(CONFIG_API_KEY)) {
            throw new UnauthorizedResponse("Unauthorized");
        }
    }

    // Handler: Get all routes
    private static final Handler getAllRoutesHandler = ctx -> {
        Map<String, ServerRoutingConfig.ServerInfo> routes = ServerRoutingConfig.getAllRoutes();
        ctx.json(routes);
    };

    // Handler: Get a specific route by domain
    private static final Handler getRouteHandler = ctx -> {
        String domain = ctx.pathParam("domain");
        if (domain.isEmpty()) {
            ctx.status(400).json(Map.of("error", "Domain is required"));
            return;
        }

        ServerRoutingConfig.ServerInfo serverInfo = ServerRoutingConfig.getServerInfo(domain);
        if (serverInfo == null) {
            ctx.status(404).json(Map.of("error", "Route not found"));
            return;
        }

        ctx.json(serverInfo);
    };

    // Handler: Create a new route
    private static final Handler createRouteHandler = ctx -> {
        RouteRequest routeRequest;
        try {
            routeRequest = ctx.bodyAsClass(RouteRequest.class);
        } catch (Exception e) {
            ctx.status(400).json(Map.of("error", "Invalid request body"));
            return;
        }

        String domain = routeRequest.getDomain();
        String host = routeRequest.getHost();
        int port = routeRequest.getPort();

        if (domain == null || domain.isEmpty() || host == null || host.isEmpty() || port <= 0) {
            ctx.status(400).json(Map.of("error", "Invalid domain, host, or port"));
            return;
        }

        ServerRoutingConfig.ServerInfo serverInfo = new ServerRoutingConfig.ServerInfo(host, port);
        boolean added = ServerRoutingConfig.addRoute(domain, serverInfo);
        if (!added) {
            ctx.status(409).json(Map.of("error", "Route already exists"));
            return;
        }

        ctx.status(201).json(Map.of("message", "Route created successfully", "route", serverInfo));
    };

    // Handler: Update an existing route
    private static final Handler updateRouteHandler = ctx -> {
        String domain = ctx.pathParam("domain");
        if (domain.isEmpty()) {
            ctx.status(400).json(Map.of("error", "Domain is required"));
            return;
        }

        RouteRequest routeRequest;
        try {
            routeRequest = ctx.bodyAsClass(RouteRequest.class);
        } catch (Exception e) {
            ctx.status(400).json(Map.of("error", "Invalid request body"));
            return;
        }

        String host = routeRequest.getHost();
        int port = routeRequest.getPort();

        if (host == null || host.isEmpty() || port <= 0) {
            ctx.status(400).json(Map.of("error", "Invalid host or port"));
            return;
        }

        ServerRoutingConfig.ServerInfo serverInfo = new ServerRoutingConfig.ServerInfo(host, port);
        boolean updated = ServerRoutingConfig.updateRoute(domain, serverInfo);
        if (!updated) {
            ctx.status(404).json(Map.of("error", "Route not found"));
            return;
        }

        ctx.json(Map.of("message", "Route updated successfully", "route", serverInfo));
    };

    // Handler: Delete a route
    private static final Handler deleteRouteHandler = ctx -> {
        String domain = ctx.pathParam("domain");
        if (domain.isEmpty()) {
            ctx.status(400).json(Map.of("error", "Domain is required"));
            return;
        }

        boolean deleted = ServerRoutingConfig.deleteRoute(domain);
        if (!deleted) {
            ctx.status(404).json(Map.of("error", "Route not found"));
            return;
        }

        ctx.status(204); // No Content
    };

    // Request model used for creating or updating routes
    public static class RouteRequest {
        private String domain; // Only required for creation
        private String host;
        private int port;

        // Getters and Setters
        public String getDomain() {
            return domain;
        }

        public void setDomain(String domain) {
            this.domain = domain;
        }

        public String getHost() {
            return host;
        }

        public void setHost(String host) {
            this.host = host;
        }

        public int getPort() {
            return port;
        }

        public void setPort(int port) {
            this.port = port;
        }
    }
}
