-- Runs once, when the local Postgres volume is first created. Tests drop and recreate this
-- database's schema, so they refuse any database whose name doesn't end in _test.
create database foreman_test;
