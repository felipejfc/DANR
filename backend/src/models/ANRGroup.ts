import mongoose, { Schema, Document } from 'mongoose';

export interface IANRGroup extends Document {
  stackTracePattern: string;
  stackTraceHash: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  anrIds: mongoose.Types.ObjectId[];
  similarity: number;
}

const ANRGroupSchema = new Schema<IANRGroup>({
  stackTracePattern: { type: String, required: true },
  stackTraceHash: { type: String, required: true, index: true, unique: true },
  count: { type: Number, default: 0 },
  firstSeen: { type: Date, required: true, default: Date.now },
  lastSeen: { type: Date, required: true, default: Date.now },
  anrIds: [{ type: Schema.Types.ObjectId, ref: 'ANR' }],
  similarity: { type: Number, default: 100 }
}, {
  timestamps: true
});

ANRGroupSchema.index({ count: -1 });
ANRGroupSchema.index({ lastSeen: -1 });

export default mongoose.model<IANRGroup>('ANRGroup', ANRGroupSchema);
