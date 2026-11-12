// [LC-CUSTOM] 用户区：平台永远不会覆盖这里，可以放心改。
// items 表的存取实现（SQL 统一写 ? 占位符，PostgreSQL 由模板自动改写）；换存储实现只改这个文件。
package custom

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"time"

	"lowcode/server/internal/generated/db"
	"lowcode/server/internal/generated/models"
)

func listItems(handle *db.Handle, limit, offset int) ([]models.Item, int64, error) {
	rows, err := handle.Query(
		`SELECT id, title, body, created_at, updated_at
		 FROM items
		 ORDER BY created_at DESC, id DESC
		 LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := []models.Item{}
	for rows.Next() {
		var item models.Item
		if err := rows.Scan(&item.ID, &item.Title, &item.Body, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, 0, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	var total int64
	if err := handle.QueryRow(`SELECT COUNT(*) FROM items`).Scan(&total); err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func getItem(handle *db.Handle, id string) (*models.Item, error) {
	var item models.Item
	err := handle.QueryRow(
		`SELECT id, title, body, created_at, updated_at FROM items WHERE id = ?`, id,
	).Scan(&item.ID, &item.Title, &item.Body, &item.CreatedAt, &item.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func createItem(handle *db.Handle, title, body string) (*models.Item, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	item := &models.Item{
		ID:        randomID(),
		Title:     title,
		Body:      body,
		CreatedAt: now,
		UpdatedAt: now,
	}
	_, err := handle.Exec(
		`INSERT INTO items (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		item.ID, item.Title, item.Body, item.CreatedAt, item.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return item, nil
}

func updateItem(handle *db.Handle, id, title, body string) (*models.Item, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	result, err := handle.Exec(
		`UPDATE items SET title = ?, body = ?, updated_at = ? WHERE id = ?`,
		title, body, now, id)
	if err != nil {
		return nil, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected == 0 {
		return nil, nil
	}
	return getItem(handle, id)
}

func deleteItem(handle *db.Handle, id string) (bool, error) {
	result, err := handle.Exec(`DELETE FROM items WHERE id = ?`, id)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

func randomID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}
