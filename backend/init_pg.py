import psycopg2
conn = psycopg2.connect(host='localhost', port=49471, user='postgres', dbname='postgres')
conn.autocommit = True
cur = conn.cursor()
cur.execute("CREATE ROLE worktrack WITH LOGIN SUPERUSER PASSWORD 'worktrack';")
cur.execute("CREATE DATABASE worktrack OWNER worktrack;")
print('role + db created')
cur.close()
conn.close()
