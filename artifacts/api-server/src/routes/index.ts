import { Router, type IRouter } from "express";
import healthRouter from "./health";
import postsRouter from "./posts";
import preferencesRouter from "./preferences";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(postsRouter);
router.use(preferencesRouter);
router.use(adminRouter);

export default router;
