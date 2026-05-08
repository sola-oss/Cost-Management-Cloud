import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, clientsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  try {
    const clients = await db.select().from(clientsTable).orderBy(clientsTable.clientCode);
    res.json({ items: clients });
  } catch (err) {
    req.log.error({ err }, "Failed to list clients");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { clientCode, name, address, tel, contactName } = req.body;
    if (!clientCode || !name) {
      return res.status(400).json({ message: "得意先コードと得意先名は必須です" });
    }
    const [client] = await db.insert(clientsTable).values({
      clientCode,
      name,
      address: address ?? null,
      tel: tel ?? null,
      contactName: contactName ?? null,
    }).returning();
    return res.status(201).json(client);
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to create client");
    if (err instanceof Error && (err as NodeJS.ErrnoException & { code?: string }).code === "23505") {
      return res.status(409).json({ message: "その得意先コードはすでに使用されています" });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const { clientCode, name, address, tel, contactName } = req.body;
    if (!clientCode || !name) {
      return res.status(400).json({ message: "得意先コードと得意先名は必須です" });
    }
    const [updated] = await db.update(clientsTable).set({
      clientCode,
      name,
      address: address ?? null,
      tel: tel ?? null,
      contactName: contactName ?? null,
      updatedAt: new Date(),
    }).where(eq(clientsTable.id, id)).returning();
    if (!updated) return res.status(404).json({ message: "得意先が見つかりません" });
    return res.json(updated);
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to update client");
    if (err instanceof Error && (err as NodeJS.ErrnoException & { code?: string }).code === "23505") {
      return res.status(409).json({ message: "その得意先コードはすでに使用されています" });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    await db.delete(clientsTable).where(eq(clientsTable.id, id));
    return res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete client");
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
