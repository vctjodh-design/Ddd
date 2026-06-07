import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import fixturesRouter from "./fixtures.js";
import fixtureDetailRouter from "./fixture-detail.js";
import bulkRouter from "./bulk.js";
import dbViewerRouter from "./dbViewer.js";
import processingRouter from "./processing.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(fixturesRouter);
router.use(fixtureDetailRouter);
router.use(bulkRouter);
router.use(dbViewerRouter);
router.use(processingRouter);

export default router;
