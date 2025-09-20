import dotenv from 'dotenv';

dotenv.config();

const config = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3001),
  zalo: {
    accessToken: process.env.ZALO_ACCESS_TOKEN || '',
    secretKey: process.env.ZALO_SECRET_KEY || ''
  },
  chatbot: {
    customBaseUrl: process.env.CHATBOT_CUSTOM_URL || '', // e.g. https://chatbotproduct.example.com
    mobileBaseUrl: process.env.CHATBOT_MOBILE_URL || '', // e.g. https://chatbotmobile.example.com
    customerId: process.env.CHATBOT_CUSTOMER_ID || '',   // optional: customer_id path param
  }
});

export default config;
