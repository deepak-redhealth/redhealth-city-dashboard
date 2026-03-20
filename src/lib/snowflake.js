import snowflake from 'snowflake-sdk';

// Connection pool singleton
let connectionPool = null;

function getPool() {
  if (!connectionPool) {
    connectionPool = snowflake.createPool(
      {
        account: process.env.SNOWFLAKE_ACCOUNT,
        username: process.env.SNOWFLAKE_USERNAME,
        password: process.env.SNOWFLAKE_PASSWORD,
        database: process.env.SNOWFLAKE_DATABASE || 'BLADE',
        schema: process.env.SNOWFLAKE_SCHEMA || 'CORE',
        warehouse: process.env.SNOWFLAKE_WAREHOUSE,
        role: process.env.SNOWFLAKE_ROLE,
      },
      { max: 5, min: 0 }
    );
  }
  return connectionPool;
}

export async function executeQuery(sql) {
  const pool = getPool();

  return new Promise((resolve, reject) => {
    pool.use(async (clientConnection) => {
      return new Promise((res, rej) => {
        clientConnection.execute({
          sqlText: sql,
          complete: (err, stmt, rows) => {
            if (err) {
              rej(err);
              reject(err);
            } else {
              res(rows);
              resolve(rows);
            }
          },
        });
      });
    });
  });
}
