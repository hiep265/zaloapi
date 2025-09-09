import dotenv from 'dotenv';

dotenv.config();

const config = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  zalo: {
    accessToken: process.env.ZALO_ACCESS_TOKEN || '',
    secretKey: process.env.ZALO_SECRET_KEY || ''
  }
});

export default config;
