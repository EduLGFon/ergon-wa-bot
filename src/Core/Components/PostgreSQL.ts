import Table from '../Classes/PgTable.js';
import { pg } from '../Typings/types.js';
import postgres from 'postgres';

const pg = postgres(process.env.DATABASE_URL!, {
	// ssl: { rejectUnauthorized: false },
}) as pg; // will use psql environment variables

pg.users = new Table('users', 'id');
pg.groups = new Table('groups', 'id');

export default pg;
