/**
 * DEVELOPMENT-ONLY transaction-local test tables. Never clears or modifies the
 * Farm's live development records, and never advances their serial sequences.
 * LIKE retains indexes/checks; foreign keys and triggers are copied explicitly.
 */
export async function isolateTables(client) {
  if (process.env.NODE_ENV === "production") throw new Error("Test isolation forbidden in production");
  const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const quoted = (name) => {
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error("Unexpected test table identifier");
    return `"${name}"`;
  };
  for (const { tablename } of rows) {
    const table = quoted(tablename);
    await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    const serials = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_default LIKE 'nextval(%'", [tablename]);
    for (const { column_name } of serials.rows) {
      const sequence = quoted(`verify_${tablename}_${column_name}`);
      await client.query(`CREATE TEMP SEQUENCE ${sequence}`);
      await client.query(`ALTER TABLE pg_temp.${table} ALTER COLUMN ${quoted(column_name)} SET DEFAULT nextval('pg_temp.${sequence}')`);
    }
  }
  for (const { tablename } of rows) {
    const constraints = await client.query("SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1::regclass AND contype='f'", [`public.${tablename}`]);
    for (const { conname, definition } of constraints.rows) {
      const local = definition.replace(/REFERENCES (?:public\.)?"?([a-z_][a-z0-9_]*)"?/g, (_match, name) => `REFERENCES pg_temp.${quoted(name)}`);
      await client.query(`ALTER TABLE pg_temp.${quoted(tablename)} ADD CONSTRAINT ${quoted(conname)} ${local}`);
    }
    const triggers = await client.query("SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid=$1::regclass AND NOT tgisinternal", [`public.${tablename}`]);
    for (const { definition } of triggers.rows) {
      await client.query(definition.replace(` ON public.${tablename} `, ` ON pg_temp.${quoted(tablename)} `));
    }
  }
}
