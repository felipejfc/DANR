import { Router, Request, Response } from 'express';
import {
  createOrUpdateANR,
  getAllANRs,
  getANRById,
  deleteANR,
  deleteAllANRs,
  getANRGroups,
  getAnalytics
} from '../services/anrService';

const router = Router();

router.post('/anrs', async (req: Request, res: Response) => {
  try {
    const anr = await createOrUpdateANR(req.body);
    res.status(201).json({
      success: true,
      data: anr
    });
  } catch (error) {
    console.error('Error creating ANR:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create ANR'
    });
  }
});

router.get('/anrs', async (req: Request, res: Response) => {
  try {
    const filters = {
      deviceModel: req.query.deviceModel as string,
      osVersion: req.query.osVersion as string,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      isMainThread: req.query.isMainThread === 'true' ? true : req.query.isMainThread === 'false' ? false : undefined,
      sort: req.query.sort as string,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
      skip: req.query.skip ? parseInt(req.query.skip as string) : 0
    };

    const result = await getAllANRs(filters);

    res.json({
      success: true,
      data: result.anrs,
      total: result.total,
      page: Math.floor((filters.skip || 0) / (filters.limit || 50)) + 1,
      pageSize: filters.limit
    });
  } catch (error) {
    console.error('Error fetching ANRs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch ANRs'
    });
  }
});

router.get('/anrs/:id', async (req: Request, res: Response) => {
  try {
    const anr = await getANRById(req.params.id);

    if (!anr) {
      return res.status(404).json({
        success: false,
        error: 'ANR not found'
      });
    }

    res.json({
      success: true,
      data: anr
    });
  } catch (error) {
    console.error('Error fetching ANR:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch ANR'
    });
  }
});

router.delete('/anrs/:id', async (req: Request, res: Response) => {
  try {
    await deleteANR(req.params.id);

    res.json({
      success: true,
      message: 'ANR deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting ANR:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete ANR'
    });
  }
});

router.delete('/anrs', async (req: Request, res: Response) => {
  try {
    await deleteAllANRs();

    res.json({
      success: true,
      message: 'All ANRs deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting all ANRs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete all ANRs'
    });
  }
});

router.get('/anrs/groups/all', async (req: Request, res: Response) => {
  try {
    const groups = await getANRGroups();

    res.json({
      success: true,
      data: groups
    });
  } catch (error) {
    console.error('Error fetching ANR groups:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch ANR groups'
    });
  }
});

router.get('/analytics', async (req: Request, res: Response) => {
  try {
    const analytics = await getAnalytics();

    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics'
    });
  }
});

export default router;
