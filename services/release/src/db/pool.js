import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  process.stderr.write(`Unexpected pg pool error: ${err.message}\n`);
});

export default pool;
