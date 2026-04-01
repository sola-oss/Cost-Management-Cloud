import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import costItemsRouter from "./cost-items";
import budgetsRouter from "./budgets";
import budgetItemsRouter from "./budget-items";
import dashboardRouter from "./dashboard";
import paymentsRouter from "./payments";
import vendorGroupsRouter from "./vendor-groups";
import vendorsRouter from "./vendors";
import paymentAssessmentsRouter from "./payment-assessments";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/projects", projectsRouter);
router.use("/projects/:id/budget-items", budgetItemsRouter);
router.use("/cost-items", costItemsRouter);
router.use("/budgets", budgetsRouter);
router.use("/dashboard", dashboardRouter);
router.use("/payments", paymentsRouter);
router.use("/vendor-groups", vendorGroupsRouter);
router.use("/vendors", vendorsRouter);
router.use("/payment-assessments", paymentAssessmentsRouter);

export default router;
