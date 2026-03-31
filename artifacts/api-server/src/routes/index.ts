import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import costItemsRouter from "./cost-items";
import budgetsRouter from "./budgets";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/projects", projectsRouter);
router.use("/cost-items", costItemsRouter);
router.use("/budgets", budgetsRouter);
router.use("/dashboard", dashboardRouter);

export default router;
