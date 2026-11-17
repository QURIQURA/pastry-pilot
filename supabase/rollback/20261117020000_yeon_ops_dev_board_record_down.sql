-- Rollback for 20261117020000_yeon_ops_dev_board_record.sql (pastry-pilot#20). Board data stays.
drop function if exists yeon_ops.dev_board_record(text, integer, integer, text, text, text, text);
