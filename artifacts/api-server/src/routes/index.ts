import { Router, type IRouter } from "express";
import healthRouter from "./health";
import fixturesRouter from "./fixtures";
import fixtureDetailRouter from "./fixture-detail";

const router: IRouter = Router();

router.use(healthRouter);
router.use(fixturesRouter);
router.use(fixtureDetailRouter);

export default router;
