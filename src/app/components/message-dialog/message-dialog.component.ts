import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

export interface MessageDialogData {
  title?: string;
  message?: string;
  imgPath?: string;
  closeMessage?: string;
  confirmMode?: boolean;
  confirmText?: string;
  cancelText?: string;
}

@Component({
  selector: 'app-message-dialog',
  templateUrl: './message-dialog.component.html',
  styleUrls: ['./message-dialog.component.scss']
})
export class MessageDialogComponent {
  title: string;
  message: string;
  imgPath: string;
  closeMessage: string;
  confirmMode: boolean;
  confirmText: string;
  cancelText: string;

  constructor(
    private readonly dialogRef: MatDialogRef<MessageDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: MessageDialogData
  ) {
    this.title = data.title || '提示';
    this.message = data.message || '發生未知錯誤';
    this.imgPath = data.imgPath || '';
    this.closeMessage = data.closeMessage || '關閉';
    this.confirmMode = !!data.confirmMode;
    this.confirmText = data.confirmText || '確認';
    this.cancelText = data.cancelText || '取消';
  }

  close(isConfirmed = false): void {
    this.dialogRef.close(isConfirmed);
  }
}
