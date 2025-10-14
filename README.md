# Line Bot Backend Service

A backend service for a Line Bot that manages wallets and expenses, built with Node.js and Express.

## Features

- 💰 Wallet Management
  - Create new wallets
  - Switch between wallets
  - View wallet details
- 💸 Expense Tracking
  - Add transactions (income/expenses)
  - View transactions by date
  - Calculate daily/monthly/yearly summaries
- 🔒 Secure API with API key authentication
- 🌍 Timezone support for different regions

## Tech Stack

- Node.js
- Express
- Oracle Database
- Vercel (Deployment)

## Prerequisites

- Node.js (v12 or higher)
- Oracle Database
- npm or yarn

## Installation

1. Clone the repository
2. Install dependencies:

```sh
npm install
```

3. Create a `.env` file with the following variables:

```sh
DB_USER="your_db_user"
DB_PASS="your_db_password"
DSN_NAME="your_oracle_connection_string"
API_KEY="your_api_key"
```

## API Endpoints

### Wallet Management

- `POST /api/createWallet` - Create a new wallet
- `GET /api/wallet` - Get current wallet details
- `GET /api/wallets` - List all wallets
- `POST /api/changeWallet` - Switch active wallet

### Expense Management

- `POST /api/add` - Add a new transaction
- `GET /api/sumall` - Get total balance
- `GET /api/sumbymonth` - Get monthly summaries
- `GET /api/sumbynote` - Get expenses grouped by notes
- `GET /api/sumday` - Get daily summary

### Utility

- `GET /api/help` - Get command help

## API Authentication

All API endpoints require an API key to be included in the request headers:

```sh
X-API-Key: your_api_key
```

## Development

Run the development server:

```sh
npm run start
```

## Deployment

The service is configured for deployment on Vercel. The `vercel.json` configuration handles API routes automatically.

## License

ISC
