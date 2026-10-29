-- número de linhas de cada tabela dos esquemas public e arquivo (para conferir a restauração)
select n.nspname || '.' || c.relname || ';' ||
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and n.nspname in ('public', 'arquivo')
order by 1;
