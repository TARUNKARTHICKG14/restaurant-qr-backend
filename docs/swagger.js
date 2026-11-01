// docs/swagger.js
const swaggerUi = require('swagger-ui-express');

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Restaurant QR Ordering API',
    version: '1.0.0',
    description: 'High-performance backend API for Contactless Table QR Ordering, Real-Time Kitchen Display System (KDS), Waiter Calling, and Restaurant Analytics.',
    contact: {
      name: 'Restaurant Engineering Team'
    }
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Local Development Server'
    }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    }
  },
  paths: {
    '/health': {
      get: {
        summary: 'Health check endpoint',
        responses: {
          200: { description: 'API is running and healthy' }
        }
      }
    },
    '/api/menu/{restaurantId}': {
      get: {
        summary: 'Fetch public menu for a restaurant',
        parameters: [
          { name: 'restaurantId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'category', in: 'query', schema: { type: 'string' } },
          { name: 'availableOnly', in: 'query', schema: { type: 'boolean' } },
          { name: 'groupByCategory', in: 'query', schema: { type: 'boolean' } }
        ],
        responses: {
          200: { description: 'Menu items or grouped categories' }
        }
      }
    },
    '/api/menu/{restaurantId}/categories': {
      get: {
        summary: 'List all unique food categories for a restaurant',
        parameters: [
          { name: 'restaurantId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          200: { description: 'Array of category strings' }
        }
      }
    },
    '/api/qr/{tableId}': {
      get: {
        summary: 'Generate table-specific QR code',
        parameters: [
          { name: 'tableId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['png', 'svg', 'json'] } },
          { name: 'size', in: 'query', schema: { type: 'integer', default: 400 } },
          { name: 'dark', in: 'query', schema: { type: 'string', default: '#000000' } },
          { name: 'light', in: 'query', schema: { type: 'string', default: '#ffffff' } },
          { name: 'download', in: 'query', schema: { type: 'boolean' } }
        ],
        responses: {
          200: { description: 'QR image (PNG/SVG) or JSON with Data URL' }
        }
      }
    },
    '/api/qr/restaurant/{restaurantId}/bulk': {
      get: {
        summary: 'Generate batch QR codes for all tables in a restaurant for sticker printing',
        parameters: [
          { name: 'restaurantId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          200: { description: 'Array of table QRs' }
        }
      }
    },
    '/api/order/table/{tableId}/session': {
      get: {
        summary: 'Check if a table has an active dining session (re-scan flow)',
        parameters: [
          { name: 'tableId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          200: { description: 'Active session details or hasActiveSession: false' }
        }
      }
    },
    '/api/order': {
      post: {
        summary: 'Place order at a table (enforces GDPR consent)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['restaurantId', 'tableId'],
                properties: {
                  restaurantId: { type: 'string', format: 'uuid' },
                  tableId: { type: 'string', format: 'uuid' },
                  notes: { type: 'string', example: 'Less spicy' },
                  customer: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      phone: { type: 'string' },
                      consentGiven: { type: 'boolean' }
                    }
                  },
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        menuItemId: { type: 'string', format: 'uuid' },
                        quantity: { type: 'integer' }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        responses: {
          201: { description: 'Order created with calculated totals' },
          400: { description: 'Validation error or GDPR consent denied' }
        }
      }
    },
    '/api/order/{id}/items': {
      post: {
        summary: 'Add more items to an ongoing table bill (re-scan addition)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          200: { description: 'Items added and cumulative total recalculated' }
        }
      }
    },
    '/api/order/{id}/apply-coupon': {
      post: {
        summary: 'Apply a promotional discount coupon code to an order',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['code'],
                properties: {
                  code: { type: 'string', example: 'WELCOME10' }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'Coupon applied and bill recalculated' }
        }
      }
    },
    '/api/order/{id}/remove-coupon': {
      delete: {
        summary: 'Remove applied coupon and revert bill',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          200: { description: 'Coupon removed' }
        }
      }
    },
    '/api/order/{id}/split': {
      get: {
        summary: 'Calculate equal bill split among diners at table',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'ways', in: 'query', schema: { type: 'integer', default: 2, minimum: 2, maximum: 20 } }
        ],
        responses: {
          200: { description: 'Itemized split breakdown with exact per-person amounts' }
        }
      }
    },
    '/api/order/table/{tableId}/call-waiter': {
      post: {
        summary: 'Call waiter or request table assistance',
        parameters: [
          { name: 'tableId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  requestType: { type: 'string', enum: ['CALL_WAITER', 'WATER', 'BILL', 'CUTLERY', 'CLEAN_TABLE', 'CUSTOM'] },
                  note: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          201: { description: 'Waiter notified' }
        }
      }
    },
    '/api/order/{id}/feedback': {
      post: {
        summary: 'Submit post-meal rating and review',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['rating'],
                properties: {
                  rating: { type: 'integer', minimum: 1, maximum: 5 },
                  comments: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          201: { description: 'Feedback recorded' }
        }
      }
    },
    '/api/kitchen/tickets': {
      get: {
        summary: 'Kitchen Display System (KDS) live orders categorized by status',
        parameters: [
          { name: 'restaurantId', in: 'query', schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          200: { description: 'Grouped tickets in pending, preparing, and ready states' }
        }
      }
    },
    '/api/kitchen/tickets/{id}/advance': {
      put: {
        summary: 'Progress kitchen ticket: PENDING -> PREPARING -> READY -> SERVED',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          200: { description: 'Ticket status advanced' }
        }
      }
    },
    '/api/admin/login': {
      post: {
        summary: 'Admin login to obtain JWT token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'JWT Token' },
          401: { description: 'Invalid credentials' }
        }
      }
    },
    '/api/admin/analytics/overview': {
      get: {
        summary: 'Comprehensive restaurant performance and sales analytics',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'restaurantId', in: 'query', schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          200: { description: 'Analytics overview with hourly rush, payment breakdown, table sales' }
        }
      }
    },
    '/api/admin/reports/sales/csv': {
      get: {
        summary: 'Download accounting sales report as CSV spreadsheet',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'restaurantId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date' } }
        ],
        responses: {
          200: { description: 'CSV file download' }
        }
      }
    }
  }
};

module.exports = {
  swaggerUi,
  swaggerDocument
};

