import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import articlesRouter from "./articles";
import inboxRouter from "./inbox";
import myCollectionsRouter from "./my-collections";
import storedSentencesRouter from "./stored-sentences";
import readingRouter from "./reading";
import teamCollectionsRouter from "./team-collections";
import neighborsRouter from "./neighbors";
import sendRecordsRouter from "./send-records";
import storageRouter from "./storage";
import spellCheckRouter from "./spell-check";
import spacesRouter from "./spaces";
import thoughtsRouter from "./thoughts";
import pushTokensRouter from "./pushTokens";
import clientLogsRouter from "./clientLogs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(articlesRouter);
router.use(inboxRouter);
router.use(myCollectionsRouter);
router.use(storedSentencesRouter);
router.use(readingRouter);
router.use(teamCollectionsRouter);
router.use(neighborsRouter);
router.use(sendRecordsRouter);
router.use(storageRouter);
router.use(spellCheckRouter);
router.use(spacesRouter);
router.use(thoughtsRouter);
router.use(pushTokensRouter);
router.use(clientLogsRouter);

export default router;
