-- Final RBAC role names.
-- Preserve existing users while renaming enum values.
ALTER TYPE "Role" RENAME VALUE 'SUPER_ADMIN' TO 'OWNER';
ALTER TYPE "Role" RENAME VALUE 'PROJECT_MANAGER' TO 'ADMIN';
