import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import fixturesRouter from "./fixtures.js";
import fixtureDetailRouter from "./fixture-detail.js";
import fixtureDetailBeRouter from "./fixture-detail-be.js";
import bulkRouter from "./bulk.js";
import dbViewerRouter from "./dbViewer.js";
import processingRouter from "./processing.js";
import modelRouter from "./model.js";
import testerRouter from "./tester.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(fixturesRouter);
router.use(fixtureDetailRouter);
router.use(fixtureDetailBeRouter);
router.use(bulkRouter);
router.use(dbViewerRouter);
router.use(processingRouter);
router.use(modelRouter);
router.use(testerRouter);

export default router;
