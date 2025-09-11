import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import routes from './routes/index.js';
import { notFoundHandler, errorHandler } from './middlewares/errorHandler.js';
import swaggerUi from 'swagger-ui-express';
import swaggerJSDoc from 'swagger-jsdoc';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// API Docs (auto-generated from JSDoc)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const routesGlob = path.join(__dirname, 'routes/**/*.js');
const controllersGlob = path.join(__dirname, 'controllers/**/*.js');
const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Zalo API Express Backend',
      version: '1.0.0',
      description: 'Tài liệu API tự động từ JSDoc. Các file được quét: src/routes/**/*.js, src/controllers/**/*.js',
    },
    servers: [{ url: 'http://localhost:3000' }],
  },
  apis: [routesGlob, controllersGlob],
});
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
