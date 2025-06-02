const expressApi = require('./api/expressApi');
const tcpProxy = require('./server/tcpProxy');

// Global error handling to prevent the process from crashing due to any unhandled errors.
// This catches errors that might slip through specific try-catch blocks or event listeners,
// ensuring the application remains stable.
// This will NOT cause the net.Socket server to crash. Instead, it acts as a last resort
// to prevent the entire Node.js process from terminating unexpectedly when an error
// is not caught anywhere else in the application.
process.on('uncaughtException', (error) => {
    console.error('[Global Error Handler] Uncaught Exception:', error);
    // In a production environment, consider logging the error and gracefully shutting down.
    // For now, we log to prevent immediate crash.
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Global Error Handler] Unhandled Rejection at:', promise, 'reason:', reason);
    // Log the unhandled rejection.
    // In a production environment, consider logging and gracefully shutting down.
});
