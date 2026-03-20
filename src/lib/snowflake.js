import snowflake from 'snowflake-sdk';

// Connection singleton
let connectionPool = null;

function getConnection() {
  return new Promise((resolve, reject) => {
    if (connectionPool) { resolve(connectionPool); return; }

    let privateKey = undefined;
    if (process.env.SNOWFLAKE_PRIVATE_KEY) {
      privateKey = process.env.SNOWFLAKE_PRIVATE_KEY.replace(/\\n/g, '\n');
    }

    if (!privateKey) {
      reject(new Error('No private key. Set SNOWFLAKE_PRIVATE_KEY in env vars'));
      return;
    }

    const connConfig = {
      account: process.env.SNOWFLAKE_ACCOUNT,
      username: process.env.SNOWFLAKE_USERNAME,
      database: process.env.SNOWFLAKE_DATABASE || 'BLADE',
      schema: process.env.SNOWFLAKE_SCHEMA || 'CORE',
      warehouse: process.env.SNOWFLAKE_WAREHOUSE,
      role: process.env.SNOWFLAKE_ROLE,
      authenticator: 'SNOWFLAKE_JWT',
      privateKey,
    };

    if (process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE) {
      connConfig.privateKeyPass = process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE;
    }

    const conn = snowflake.createConnection(connConfig);
    conn.connect((err, c) => {
      if (err) { reject(err); return; }
      connectionPool = c;
      resolve(c);
    });
  });
}

export async function executeQuery(sql) {
  const conn = await getConnection();
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: sql,
      complete: (err, _stmt, rows) => {
        if (err) { reject(err); return; }
        resolve(rows || []);
      },
    });
  });
}
