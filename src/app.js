import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import routes from './routes/index.js';
import { notFoundHandler, errorHandler } from './middlewares/errorHandler.js';
import swaggerUi from 'swagger-ui-express';
import swaggerJSDoc from 'swagger-jsdoc';

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// API Docs (auto-generated from JSDoc)
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
  apis: ['src/routes/**/*.js', 'src/controllers/**/*.js'],
});
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
